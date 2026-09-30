/**
 * Votes, scores and replies to replies, asserted against the live database
 * (migration 0030).
 *
 * The score a feed sorts by is kept by a trigger. These check it against a
 * fresh sum of the votes after every kind of change — a vote, a change of
 * mind, a vote taken back, a voter leaving the forum — because a score that
 * drifts is wrong on every page at once and looks right on each.
 *
 * And the wall: a vote is never public one by one. No public role reads
 * forum_votes, no view reads it, and the views carry only the total.
 *
 * Everything that writes runs inside a transaction that is rolled back.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql, inRollback } from "./helpers.mjs";
import { hotRank } from "../lib/forum/rank.ts";

after(() => sql.end());

async function roleExists(role) {
  const [{ exists }] = await sql`select exists (select 1 from pg_roles where rolname = ${role}) as exists`;
  return exists;
}

/** A throwaway member inside the caller's transaction (as in forum-schema.test.mjs). */
async function makeMember(tx, n) {
  const id = randomUUID();
  const [{ auth }] = await tx`
    select exists (select 1 from information_schema.tables
                    where table_schema = 'auth' and table_name = 'users') as auth`;
  if (auth)
    await tx`insert into auth.users (id, aud, role, email)
             values (${id}::uuid, 'authenticated', 'authenticated', ${`${id}@example.test`})`;
  await tx`insert into profiles (id) values (${id}::uuid) on conflict (id) do nothing`;
  await tx`insert into forum_profiles (user_id, nickname_key, nickname_no, age_band, guidelines_version, guidelines_accepted_at)
           values (${id}::uuid, 'vote-test', ${n}, '18_plus', 1, now())`;
  return id;
}

/** A visible thread, returning its id and its opening post's. */
async function makeThread(tx, author, { status = "visible", createdAt = null } = {}) {
  const [cat] = await tx`select id from forum_categories where slug = 'project'`;
  const [t] = await tx`
    insert into forum_threads (category_id, author_id, title, status, created_at)
    values (${cat.id}, ${author}::uuid, 'vote test', ${status}, coalesce(${createdAt}::timestamptz, now()))
    returning id`;
  const [p] = await tx`insert into forum_posts (thread_id, author_id, is_opener, body, status)
                       values (${t.id}, ${author}::uuid, true, 'opening post', ${status}) returning id`;
  await tx`insert into forum_post_meta (post_id, author_id) values (${p.id}, ${author}::uuid)`;
  return { thread: t.id, opener: p.id };
}

async function reply(tx, thread, author, { parent = null, status = "visible", body = "a reply" } = {}) {
  const [p] = await tx`
    insert into forum_posts (thread_id, author_id, parent_id, body, status)
    values (${thread}, ${author}::uuid, ${parent}::uuid, ${body}, ${status})
    returning id, parent_id, path`;
  return p;
}

const vote = (tx, post, voter, value) =>
  tx`insert into forum_votes (post_id, voter_id, value) values (${post}, ${voter}::uuid, ${value})
     on conflict (post_id, voter_id) do update set value = excluded.value`;

/** The stored score and a fresh sum, which must always agree. */
async function scores(tx, post) {
  const [row] = await tx`
    select p.score as stored,
           (select coalesce(sum(v.value), 0)::int from forum_votes v where v.post_id = p.id) as summed
      from forum_posts p where p.id = ${post}`;
  assert.equal(row.stored, row.summed, "the stored score is the sum of the votes");
  return row.stored;
}

describe("the score is the sum of the votes", () => {
  test("through voting, changing a vote and taking it back", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 2001);
      const [a, b, c] = [await makeMember(tx, 2002), await makeMember(tx, 2003), await makeMember(tx, 2004)];
      const { opener } = await makeThread(tx, author);

      await vote(tx, opener, a, 1);
      assert.equal(await scores(tx, opener), 1);
      await vote(tx, opener, b, 1);
      await vote(tx, opener, c, -1);
      assert.equal(await scores(tx, opener), 1);
      await vote(tx, opener, a, -1); // a changes their mind: +1 becomes -1
      assert.equal(await scores(tx, opener), -1);
      await tx`delete from forum_votes where post_id = ${opener} and voter_id = ${b}::uuid`;
      assert.equal(await scores(tx, opener), -2);
    });
  });

  test("a voter leaving the forum takes their votes, and the score goes down with them", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 2011);
      const [a, b] = [await makeMember(tx, 2012), await makeMember(tx, 2013)];
      const { opener } = await makeThread(tx, author);
      await vote(tx, opener, a, 1);
      await vote(tx, opener, b, 1);
      await tx`delete from forum_profiles where user_id = ${a}::uuid`;
      assert.equal(await scores(tx, opener), 1);
      const [{ n }] = await tx`select count(*)::int as n from forum_votes where voter_id = ${a}::uuid`;
      assert.equal(n, 0);
    });
  });

  test("a vote on one post moves no other post's score", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 2021);
      const a = await makeMember(tx, 2022);
      const { thread, opener } = await makeThread(tx, author);
      const r = await reply(tx, thread, author);
      await vote(tx, r.id, a, 1);
      assert.equal(await scores(tx, r.id), 1);
      assert.equal(await scores(tx, opener), 0);
    });
  });

  test("one vote per member per post", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const author = await makeMember(tx, 2031);
          const a = await makeMember(tx, 2032);
          const { opener } = await makeThread(tx, author);
          await tx`insert into forum_votes (post_id, voter_id, value) values (${opener}, ${a}::uuid, 1)`;
          await tx`insert into forum_votes (post_id, voter_id, value) values (${opener}, ${a}::uuid, 1)`;
        }),
      /duplicate key/,
    );
  });

  test("a vote is +1 or -1; taking it back deletes it", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const author = await makeMember(tx, 2041);
          const a = await makeMember(tx, 2042);
          const { opener } = await makeThread(tx, author);
          await tx`insert into forum_votes (post_id, voter_id, value) values (${opener}, ${a}::uuid, 5)`;
        }),
      /check constraint/,
    );
  });
});

describe("what the database refuses to count", () => {
  test("a vote on your own post", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const author = await makeMember(tx, 2051);
          const { opener } = await makeThread(tx, author);
          await vote(tx, opener, author, 1);
        }),
      /cannot vote on their own post/,
    );
  });

  test("a vote on a post whose author has left", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const author = await makeMember(tx, 2052);
          const a = await makeMember(tx, 2053);
          const { opener } = await makeThread(tx, author);
          await tx`delete from forum_profiles where user_id = ${author}::uuid`;
          await vote(tx, opener, a, 1);
        }),
      /author has left/,
    );
  });

  test("a vote on your own post after leaving, the metadata's purge, and rejoining", async () => {
    // Leaving sets the post's author to null. After 180 days the retention job
    // purges forum_post_meta, the last record of who wrote it; this is the
    // member coming back after that (review of the forum-reddit work, 30
    // September 2026: it used to be let through).
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const author = await makeMember(tx, 2054);
          const { opener } = await makeThread(tx, author);
          await tx`delete from forum_profiles where user_id = ${author}::uuid`;
          await tx`delete from forum_post_meta where post_id = ${opener}`;
          await tx`insert into forum_profiles (user_id, nickname_key, nickname_no, age_band, guidelines_version, guidelines_accepted_at)
                   values (${author}::uuid, 'vote-test', 2055, '18_plus', 1, now())`;
          await vote(tx, opener, author, 1);
        }),
      /author has left/,
    );
  });

  test("the votes a post had when its author left stay counted, and can go", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 2056);
      const [a, b] = [await makeMember(tx, 2057), await makeMember(tx, 2058)];
      const { opener } = await makeThread(tx, author);
      await vote(tx, opener, a, 1);
      await vote(tx, opener, b, 1);
      await tx`delete from forum_profiles where user_id = ${author}::uuid`;
      assert.equal(await scores(tx, opener), 2);
      // A voter leaving takes theirs with them, as anywhere.
      await tx`delete from forum_profiles where user_id = ${b}::uuid`;
      assert.equal(await scores(tx, opener), 1);
      // Changing one is a new vote on it, and refused.
      await assert.rejects(() => tx.savepoint((sp) => vote(sp, opener, a, -1)), /author has left/);
      assert.equal(await scores(tx, opener), 1);
    });
  });

  for (const status of ["held", "hidden", "deleted"]) {
    test(`a vote on a ${status} post`, async () => {
      await assert.rejects(
        () =>
          inRollback(async (tx) => {
            const author = await makeMember(tx, 2061);
            const a = await makeMember(tx, 2062);
            const { thread } = await makeThread(tx, author);
            const r = await reply(tx, thread, author, { status });
            await vote(tx, r.id, a, 1);
          }),
        /only a visible post/,
      );
    });
  }

  test("a vote on a visible reply in a held thread", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const author = await makeMember(tx, 2071);
          const a = await makeMember(tx, 2072);
          const { thread } = await makeThread(tx, author, { status: "held" });
          const r = await reply(tx, thread, author);
          await vote(tx, r.id, a, 1);
        }),
      /only a visible post/,
    );
  });

  test("a vote in an archived community", async () => {
    // The public views leave an archived community out, so its posts are
    // not the public's to rank.
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const author = await makeMember(tx, 2076);
          const a = await makeMember(tx, 2077);
          const { opener } = await makeThread(tx, author);
          await tx`update forum_categories set archived = true where slug = 'project'`;
          await vote(tx, opener, a, 1);
        }),
      /only a visible post/,
    );
  });

  test("a vote from someone who has not joined", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const author = await makeMember(tx, 2081);
          const { opener } = await makeThread(tx, author);
          await vote(tx, opener, randomUUID(), 1);
        }),
      /foreign key/,
    );
  });
});

describe("votes are never public one by one", () => {
  for (const role of ["web_anon", "anon", "authenticated"]) {
    test(`${role} cannot read or write forum_votes`, async (t) => {
      if (!(await roleExists(role))) return t.skip(`role ${role} not present on this cluster`);
      for (const stmt of ["select 1 from forum_votes limit 1", "delete from forum_votes"])
        await assert.rejects(
          () =>
            sql.begin(async (tx) => {
              await tx.unsafe(`set local role ${role}`);
              await tx.unsafe(stmt);
            }),
          (err) => /permission denied/i.test(err.message),
          stmt,
        );
    });
  }

  test("no view reads forum_votes", async () => {
    const rows = await sql`
      select viewname from pg_views where schemaname = 'public' and definition ilike '%forum_votes%'`;
    assert.deepEqual(rows.map((r) => r.viewname), []);
  });

  test("the public views carry the total and where a reply sits, and no voter", async () => {
    const cols = await sql`
      select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('forum_threads_public', 'forum_posts_public')`;
    const has = (t, c) => cols.some((r) => r.table_name === t && r.column_name === c);
    for (const c of ["opener_id", "score", "hot"]) assert.ok(has("forum_threads_public", c), c);
    for (const c of ["parent_id", "path", "score"]) assert.ok(has("forum_posts_public", c), c);
    assert.deepEqual(cols.filter((r) => /voter|vote/.test(r.column_name)).map((r) => r.column_name), []);
  });

  test("the new trigger functions are not callable by any public role", async () => {
    const rows = await sql`
      select p.proname, r.rolname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        cross join pg_roles r
       where p.proname in ('forum_place_reply', 'forum_votes_check', 'forum_votes_score')
         and r.rolname in ('web_anon', 'anon', 'authenticated')
         and has_function_privilege(r.oid, p.oid, 'execute')`;
    assert.deepEqual(rows.map((r) => `${r.rolname} ${r.proname}`), []);
  });
});

describe("the public view ranks by the same Hot as the code", () => {
  test("forum_threads_public.hot is hotRank(score, created_at)", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 2091);
      const voters = [];
      for (let i = 0; i < 12; i++) voters.push(await makeMember(tx, 2100 + i));
      const cases = [
        { at: "2026-09-01T00:00:00Z", ups: 0, downs: 0 },
        { at: "2026-09-02T06:30:00Z", ups: 12, downs: 0 },
        { at: "2026-09-03T12:00:00Z", ups: 1, downs: 4 },
      ];
      const ids = [];
      for (const c of cases) {
        const { thread, opener } = await makeThread(tx, author, { createdAt: c.at });
        for (let i = 0; i < c.ups; i++) await vote(tx, opener, voters[i], 1);
        for (let i = 0; i < c.downs; i++) await vote(tx, opener, voters[c.ups + i], -1);
        ids.push(thread);
      }
      await tx`set local role web_anon`;
      const rows = await tx`select id, score, hot, created_at from forum_threads_public where id = any(${ids}::uuid[])`;
      assert.equal(rows.length, 3);
      for (const r of rows) {
        const want = hotRank(r.score, new Date(r.created_at));
        assert.ok(Math.abs(r.hot - want) < 1e-9, `score ${r.score}: view ${r.hot}, code ${want}`);
      }
      assert.deepEqual(rows.map((r) => r.score).sort((a, b) => a - b), [-3, 0, 12]);
    });
  });
});

describe("replies to replies", () => {
  test("each reply sits under the one it answers, down to the fourth level, then beside it", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 2201);
      const { thread } = await makeThread(tx, author);
      const r1 = await reply(tx, thread, author);
      const r2 = await reply(tx, thread, author, { parent: r1.id });
      const r3 = await reply(tx, thread, author, { parent: r2.id });
      const r4 = await reply(tx, thread, author, { parent: r3.id });
      const r5 = await reply(tx, thread, author, { parent: r4.id });
      assert.deepEqual(r1.path, []);
      assert.deepEqual(r2.path, [r1.id]);
      assert.deepEqual(r3.path, [r1.id, r2.id]);
      assert.deepEqual(r4.path, [r1.id, r2.id, r3.id]);
      // Past the fourth level: beside r4, still answering it.
      assert.deepEqual(r5.path, [r1.id, r2.id, r3.id]);
      assert.equal(r5.parent_id, r4.id);
    });
  });

  test("the path is the database's, whatever the insert says", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 2211);
      const { thread } = await makeThread(tx, author);
      const [p] = await tx`
        insert into forum_posts (thread_id, author_id, body, path)
        values (${thread}, ${author}::uuid, 'tries to place itself', array[gen_random_uuid()])
        returning path`;
      assert.deepEqual(p.path, []);
    });
  });

  test("a reply does not move afterwards", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 2221);
      const { thread } = await makeThread(tx, author);
      const a = await reply(tx, thread, author);
      const b = await reply(tx, thread, author);
      const c = await reply(tx, thread, author, { parent: a.id });
      await tx`update forum_posts set path = '{}' where id = ${c.id}`;
      const [{ path }] = await tx`select path from forum_posts where id = ${c.id}`;
      assert.deepEqual(path, [a.id], "a new path is ignored");
      await assert.rejects(
        () => tx.savepoint((sp) => sp`update forum_posts set parent_id = ${b.id} where id = ${c.id}`),
        /keeps the post it answers/,
      );
    });
  });

  test("a reply answers a post in its own thread only", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const author = await makeMember(tx, 2231);
          const one = await makeThread(tx, author);
          const other = await makeThread(tx, author);
          const there = await reply(tx, other.thread, author);
          await reply(tx, one.thread, author, { parent: there.id });
        }),
      /foreign key/,
    );
  });

  test("a reply to the opening post is a top-level reply, with no parent", async () => {
    await assert.rejects(
      () =>
        inRollback(async (tx) => {
          const author = await makeMember(tx, 2241);
          const { thread, opener } = await makeThread(tx, author);
          await reply(tx, thread, author, { parent: opener });
        }),
      /has no parent/,
    );
  });

  test("when a reply is purged, the answers to it keep their place", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 2251);
      const { thread } = await makeThread(tx, author);
      const a = await reply(tx, thread, author);
      const b = await reply(tx, thread, author, { parent: a.id });
      // What the retention job does to a reply deleted 180 days ago.
      await tx`update forum_posts set status = 'deleted', deleted_at = now() where id = ${a.id}`;
      await tx`delete from forum_posts where id = ${a.id}`;
      const [after] = await tx`select parent_id, path, thread_id from forum_posts where id = ${b.id}`;
      assert.equal(after.parent_id, null);
      assert.deepEqual(after.path, [a.id], "still under where a was, which the page shows as [removed]");
      assert.equal(after.thread_id, thread);
    });
  });

  test("the public sees a reply under a hidden one, and the hidden one's id, never its text", async () => {
    await inRollback(async (tx) => {
      const author = await makeMember(tx, 2261);
      const { thread } = await makeThread(tx, author);
      const a = await reply(tx, thread, author, { body: "the hidden words" });
      const b = await reply(tx, thread, author, { parent: a.id, body: "the answer" });
      await tx`update forum_posts set status = 'hidden' where id = ${a.id}`;
      await tx`set local role web_anon`;
      const rows = await tx`select id, body, parent_id, path from forum_posts_public where thread_id = ${thread} and not is_opener`;
      assert.deepEqual(rows.map((r) => r.body), ["the answer"]);
      assert.equal(rows[0].id, b.id);
      assert.deepEqual(rows[0].path, [a.id]);
    });
  });
});
