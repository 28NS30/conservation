/**
 * The forum's wall, asserted against the live database (migration 0019).
 *
 * The same boundary as reports: the public roles get nothing on a forum base
 * table, `web_anon` reads four *_public views and nothing else, and those views
 * return only what is public — visible posts in visible threads, named by
 * nickname, never by user id. A forum post is a way to publish a location,
 * so its wall has to be as tested as the one around `reports`.
 *
 * Everything that writes runs inside a transaction that is rolled back.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql, inRollback } from "./helpers.mjs";

after(() => sql.end());

const BASE_TABLES = [
  "forum_categories",
  "forum_profiles",
  "forum_threads",
  "forum_posts",
  "forum_post_meta",
  "forum_post_revisions",
  "forum_flags",
  "forum_sanctions",
  "forum_watched_words",
  "forum_mod_actions",
];
const VIEWS = ["forum_categories_public", "forum_threads_public", "forum_posts_public", "forum_profiles_public"];

async function roleExists(role) {
  const [{ exists }] = await sql`select exists (select 1 from pg_roles where rolname = ${role}) as exists`;
  return exists;
}

/** A throwaway account inside the caller's transaction. */
async function makeUser(tx, { role = "user" } = {}) {
  const id = randomUUID();
  const [{ auth }] = await tx`
    select exists (select 1 from information_schema.tables
                    where table_schema = 'auth' and table_name = 'users') as auth`;
  if (auth)
    await tx`insert into auth.users (id, aud, role, email)
             values (${id}::uuid, 'authenticated', 'authenticated', ${`${id}@example.test`})`;
  await tx`insert into profiles (id, role) values (${id}::uuid, ${role})
           on conflict (id) do update set role = excluded.role`;
  return id;
}

async function makeMember(tx, n, opts) {
  const id = await makeUser(tx, opts);
  await tx`insert into forum_profiles (user_id, nickname_key, nickname_no, age_band, guidelines_version, guidelines_accepted_at)
           values (${id}::uuid, 'test-animal', ${n}, '18_plus', 1, now())`;
  return id;
}

async function makeThread(tx, author, { status = "visible", posts = [] } = {}) {
  const [cat] = await tx`select id from forum_categories where slug = 'project'`;
  const [t] = await tx`insert into forum_threads (category_id, author_id, title, status)
                       values (${cat.id}, ${author}::uuid, 'schema test', ${status}) returning id`;
  await tx`insert into forum_posts (thread_id, author_id, is_opener, body, status)
           values (${t.id}, ${author}::uuid, true, 'opening post', ${status})`;
  for (const [body, s] of posts)
    await tx`insert into forum_posts (thread_id, author_id, body, status) values (${t.id}, ${author}::uuid, ${body}, ${s})`;
  return t.id;
}

describe("the public roles are refused on every forum base table", () => {
  for (const role of ["web_anon", "anon", "authenticated"]) {
    for (const table of BASE_TABLES) {
      test(`${role} cannot read ${table}`, async (t) => {
        if (!(await roleExists(role))) return t.skip(`role ${role} not present on this cluster`);
        await assert.rejects(
          () =>
            sql.begin(async (tx) => {
              await tx.unsafe(`set local role ${role}`);
              await tx.unsafe(`select 1 from ${table} limit 1`);
            }),
          (err) => /permission denied/i.test(err.message),
        );
      });
    }
    test(`${role} cannot write a post`, async (t) => {
      if (!(await roleExists(role))) return t.skip(`role ${role} not present on this cluster`);
      await assert.rejects(
        () =>
          sql.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
            await tx`insert into forum_posts (thread_id, body) values (gen_random_uuid(), 'x')`;
          }),
        (err) => /permission denied/i.test(err.message),
      );
    });
  }

  for (const role of ["anon", "authenticated"]) {
    test(`${role} — the REST API's roles — cannot read even the public views`, async (t) => {
      if (!(await roleExists(role))) return t.skip(`role ${role} not present on this cluster`);
      for (const view of VIEWS)
        await assert.rejects(
          () =>
            sql.begin(async (tx) => {
              await tx.unsafe(`set local role ${role}`);
              await tx.unsafe(`select 1 from ${view} limit 1`);
            }),
          (err) => /permission denied/i.test(err.message),
          view,
        );
    });
  }

  test("web_anon reads the four public views", async () => {
    await sql.begin(async (tx) => {
      await tx`set local role web_anon`;
      for (const view of VIEWS) await tx.unsafe(`select * from ${view} limit 1`);
    });
  });

  test("the grants say the same thing the refusals do", async () => {
    const rows = await sql`
      select table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name like 'forum\\_%'
         and grantee in ('web_anon', 'anon', 'authenticated', 'PUBLIC')`;
    const wrong = rows.filter((r) => !(r.grantee === "web_anon" && VIEWS.includes(r.table_name) && r.privilege_type === "SELECT"));
    assert.deepEqual(wrong.map((r) => `${r.grantee} ${r.privilege_type} ${r.table_name}`), []);
  });

  test("every forum table has row-level security on, and no policy", async () => {
    const rows = await sql`
      select c.relname, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'forum\\_%'`;
    assert.deepEqual(rows.map((r) => r.relname).sort(), [...BASE_TABLES].sort());
    for (const r of rows) {
      assert.equal(r.rls, true, `${r.relname} has RLS off`);
      assert.equal(r.policies, 0, `${r.relname} has a policy`);
    }
  });
});

describe("what the public views may say", () => {
  test("no public view has a user id, an email or an IP column", async () => {
    const cols = await sql`
      select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name = any(${VIEWS})`;
    const bad = cols.filter((c) => /(^|_)(user_id|author_id|reporter_id|actor_id|email|ip|ip_hash|user_agent|age_band)$/.test(c.column_name));
    assert.deepEqual(bad.map((c) => `${c.table_name}.${c.column_name}`), []);
  });

  test("no view reads the restricted tables", async () => {
    const rows = await sql`
      select viewname from pg_views
       where schemaname = 'public'
         and (definition ilike '%forum_post_meta%' or definition ilike '%forum_post_revisions%'
              or definition ilike '%forum_flags%' or definition ilike '%forum_sanctions%')`;
    assert.deepEqual(rows.map((r) => r.viewname), []);
  });

  test("the views are security barriers", async () => {
    const rows = await sql`
      select c.relname, c.reloptions from pg_class c
       where c.relname = any(${VIEWS})`;
    for (const r of rows) assert.ok((r.reloptions ?? []).includes("security_barrier=true"), r.relname);
  });

  test("only visible posts in visible threads come through", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 1001);
      const open = await makeThread(tx, author, {
        posts: [
          ["public reply", "visible"],
          ["held reply", "held"],
          ["hidden reply", "hidden"],
          ["deleted reply", "deleted"],
        ],
      });
      const heldThread = await makeThread(tx, author, { status: "held" });
      await tx`set local role web_anon`;
      const posts = await tx`select body from forum_posts_public where thread_id in (${open}, ${heldThread}) order by body`;
      assert.deepEqual(posts.map((p) => p.body), ["opening post", "public reply"]);
      const threads = await tx`select id from forum_threads_public where id in (${open}, ${heldThread})`;
      assert.deepEqual(threads.map((t) => t.id), [open]);
    });
  });

  test("an archived category takes its threads with it", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 1002);
      const id = await makeThread(tx, author);
      await tx`update forum_categories set archived = true where slug = 'project'`;
      await tx`set local role web_anon`;
      assert.equal((await tx`select 1 from forum_threads_public where id = ${id}`).length, 0);
      assert.equal((await tx`select 1 from forum_posts_public where thread_id = ${id}`).length, 0);
    });
  });

  test("a deleted member's posts stay, with no name", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 1003);
      const id = await makeThread(tx, author);
      await tx`delete from forum_profiles where user_id = ${author}::uuid`;
      const [p] = await tx`select author_id from forum_posts where thread_id = ${id}`;
      assert.equal(p.author_id, null, "leaving the forum anonymises authorship");
      await tx`set local role web_anon`;
      const [pub] = await tx`select body, author_handle from forum_posts_public where thread_id = ${id}`;
      assert.deepEqual(pub, { body: "opening post", author_handle: null });
    });
  });

  test("a thread's reply count and activity count only visible posts", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 1004);
      const id = await makeThread(tx, author, { posts: [["a", "visible"], ["b", "held"], ["c", "visible"]] });
      const [t] = await tx`select visible_reply_count from forum_threads where id = ${id}`;
      assert.equal(t.visible_reply_count, 2);
      await tx`update forum_posts set status = 'hidden' where thread_id = ${id} and body = 'a'`;
      const [t2] = await tx`select visible_reply_count from forum_threads where id = ${id}`;
      assert.equal(t2.visible_reply_count, 1);
    });
  });
});

describe("the moderation log is append-only", () => {
  for (const [what, stmt] of [
    ["UPDATE", (tx, id) => tx`update forum_mod_actions set reason = 'changed' where id = ${id}`],
    ["DELETE", (tx, id) => tx`delete from forum_mod_actions where id = ${id}`],
    ["TRUNCATE", (tx) => tx`truncate forum_mod_actions`],
  ]) {
    test(`${what} is refused`, async () => {
      await assert.rejects(
        () =>
          inRollback(async (tx) => {
            const [row] = await tx`
              insert into forum_mod_actions (actor_id, action, target_type, target_id, reason)
              values (gen_random_uuid(), 'hide', 'post', 'x', 'test') returning id`;
            await stmt(tx, row.id);
          }),
        /append-only/,
      );
    });
  }

  test("deleting an account does not trip it", async () => {
    // No foreign key may point from the log at an account: on delete set null
    // is an UPDATE, which the log refuses, and leaving would become impossible.
    const fks = await sql`
      select conname from pg_constraint
       where conrelid = 'forum_mod_actions'::regclass and contype = 'f'`;
    assert.deepEqual(fks.map((f) => f.conname), []);
  });
});

describe("the constraints", () => {
  test("13 to 17 needs a guardian acknowledgement", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const id = await makeUser(tx);
          await tx`insert into forum_profiles (user_id, nickname_key, nickname_no, age_band, guidelines_version, guidelines_accepted_at)
                   values (${id}::uuid, 'otter', 1234, '13_17', 1, now())`;
        }),
      /forum_profiles_guardian_ack/,
    );
  });

  test("under 13 cannot be stored at all", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const id = await makeUser(tx);
          await tx`insert into forum_profiles (user_id, nickname_key, nickname_no, age_band, guidelines_version, guidelines_accepted_at)
                   values (${id}::uuid, 'otter', 1234, 'under_13', 1, now())`;
        }),
      /check constraint/,
    );
  });

  test("a nickname is a key and four digits, and unique", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const id = await makeUser(tx);
          await tx`insert into forum_profiles (user_id, nickname_key, nickname_no, age_band, guidelines_version, guidelines_accepted_at)
                   values (${id}::uuid, 'John Smith', 1234, '18_plus', 1, now())`;
        }),
      /check constraint/,
    );
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          await makeMember(tx, 4321);
          const other = await makeUser(tx);
          await tx`insert into forum_profiles (user_id, nickname_key, nickname_no, age_band, guidelines_version, guidelines_accepted_at)
                   values (${other}::uuid, 'test-animal', 4321, '18_plus', 1, now())`;
        }),
      /duplicate key/,
    );
  });

  test("a post is at most 5,000 characters", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const author = await makeMember(tx, 1005);
          const id = await makeThread(tx, author);
          await tx`insert into forum_posts (thread_id, body) values (${id}, ${"x".repeat(5001)})`;
        }),
      /check constraint/,
    );
  });

  test("leaving and rejoining does not end a suspension", async () => {
    await inRollback(async (tx) => {
      const id = await makeMember(tx, 1006);
      await tx`insert into forum_sanctions (user_id, ends_at, reason, actor_id)
               values (${id}::uuid, now() + interval '1 day', 'test', gen_random_uuid())`;
      await tx`delete from forum_profiles where user_id = ${id}::uuid`;
      const [{ n }] = await tx`select count(*)::int as n from forum_sanctions where user_id = ${id}::uuid`;
      assert.equal(n, 1);
    });
  });
});

describe("the seed", () => {
  test("five topics, named in both languages", async () => {
    const rows = await sql`select slug, name_zh, name_en, description_zh, description_en from forum_categories order by sort`;
    for (const slug of ["announcements", "sightings-id", "roadkill", "invasive", "project"])
      assert.ok(rows.some((r) => r.slug === slug), slug);
    for (const r of rows) {
      assert.ok(r.name_zh && r.name_en && r.description_zh && r.description_en, r.slug);
      assert.ok(!/台灣|您/.test(r.name_zh + r.description_zh), `${r.slug}: house style is 臺灣 and 你`);
    }
  });

  test("the starting word list never holds 幹 on its own", async () => {
    const rows = await sql`select word from forum_watched_words where word = '幹'`;
    assert.equal(rows.length, 0);
  });
});
