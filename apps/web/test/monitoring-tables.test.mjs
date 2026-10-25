/**
 * The two monitoring tables (migration 0036), asserted against the live
 * database: who may touch them, what they refuse to hold, and the very
 * statements the server runs against them (lib/monitoring.ts).
 *
 * Both are base tables nobody outside the server may read: row-level security
 * on, no policy, nothing granted to `web_anon`, `anon` or `authenticated`.
 * They hold nothing personal by design, which is a reason to keep them shut,
 * not a reason to open them: an error count by route is a map of where the
 * site is weak.
 *
 * Everything that writes runs inside a transaction that is rolled back. So
 * does the one statement here that reads another table: /api/health's count
 * of the classification queue, which has to count what the worker would
 * claim and nothing it never will.
 *
 *   node --test test/monitoring-tables.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql, inRollback, insertReport } from "./helpers.mjs";
import {
  APP_ERROR_UPSERT,
  APP_ERRORS_PER_HOUR,
  CLASSIFICATION_QUEUE,
  JOBS,
  JOB_RUN_AGES,
  JOB_RUN_FINISH,
  JOB_RUN_START,
  QUEUE_MAX_ATTEMPTS,
  QUEUE_STALE_AFTER,
} from "../lib/monitoring.ts";

after(() => sql.end());

const TABLES = ["job_runs", "app_errors"];

async function roleExists(role) {
  const [{ exists }] = await sql`select exists (select 1 from pg_roles where rolname = ${role}) as exists`;
  return exists;
}

describe("the public roles are refused on both tables", () => {
  for (const role of ["web_anon", "anon", "authenticated"]) {
    for (const table of TABLES) {
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

    test(`${role} cannot write either`, async (t) => {
      if (!(await roleExists(role))) return t.skip(`role ${role} not present on this cluster`);
      await assert.rejects(
        () =>
          sql.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
            await tx.unsafe(JOB_RUN_START, ["classify"]);
          }),
        (err) => /permission denied/i.test(err.message),
      );
      await assert.rejects(
        () =>
          sql.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
            await tx.unsafe(APP_ERROR_UPSERT, ["/", "", APP_ERRORS_PER_HOUR]);
          }),
        (err) => /permission denied/i.test(err.message),
      );
    });
  }

  test("the grants say the same thing the refusals do", async () => {
    const rows = await sql`
      select table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = any(${TABLES})
         and grantee in ('web_anon', 'anon', 'authenticated', 'PUBLIC')`;
    assert.deepEqual(rows.map((r) => `${r.grantee} ${r.privilege_type} ${r.table_name}`), []);
    const [{ granted }] = await sql`
      select coalesce(bool_or(has_sequence_privilege(r.rolname, 'job_runs_id_seq', 'usage')), false) as granted
        from pg_roles r where r.rolname in ('web_anon', 'anon', 'authenticated')`;
    assert.equal(granted, false, "a public role may use job_runs' sequence");
  });

  test("both have row-level security on, and no policy", async () => {
    const rows = await sql`
      select c.relname, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname = any(${TABLES})`;
    assert.deepEqual(rows.map((r) => r.relname).sort(), [...TABLES].sort());
    for (const r of rows) {
      assert.equal(r.rls, true, `${r.relname} has RLS off`);
      assert.equal(r.policies, 0, `${r.relname} has a policy`);
    }
  });

  test("neither has a column that could hold a person", async () => {
    const cols = await sql`
      select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name = any(${TABLES})
       order by 1, 2`;
    assert.deepEqual(
      cols.map((c) => `${c.table_name}.${c.column_name}`),
      [
        "app_errors.count",
        "app_errors.digest",
        "app_errors.hour",
        "app_errors.route",
        "job_runs.detail",
        "job_runs.finished_at",
        "job_runs.id",
        "job_runs.job",
        "job_runs.ok",
        "job_runs.started_at",
      ],
    );
  });
});

describe("job_runs", () => {
  test("a run is started, finished, and then has an age", async () => {
    await inRollback(async (tx) => {
      // Older than any real run, so this transaction's row decides nothing below
      // unless it is the only one.
      await tx`delete from job_runs where job = 'classify'`;
      const [{ id }] = await tx.unsafe(JOB_RUN_START, ["classify"]);
      assert.equal(typeof id, "number");
      let ages = await tx.unsafe(JOB_RUN_AGES, [[...JOBS]]);
      assert.equal(ages.find((r) => r.job === "classify"), undefined, "an unfinished run is not a good one");

      await tx.unsafe(JOB_RUN_FINISH, [id, true, '{"claimed":0,"processed":0,"failed":0,"deferred":0}']);
      ages = await tx.unsafe(JOB_RUN_AGES, [[...JOBS]]);
      const age = ages.find((r) => r.job === "classify");
      assert.ok(age && age.seconds >= 0 && age.seconds < 60, JSON.stringify(age));
    });
  });

  test("a failed run is not a good run", async () => {
    await inRollback(async (tx) => {
      await tx`delete from job_runs where job = 'cleanup-orphans'`;
      const [{ id }] = await tx.unsafe(JOB_RUN_START, ["cleanup-orphans"]);
      await tx.unsafe(JOB_RUN_FINISH, [id, false, "threw PostgresError 57014"]);
      const ages = await tx.unsafe(JOB_RUN_AGES, [[...JOBS]]);
      assert.equal(ages.find((r) => r.job === "cleanup-orphans"), undefined);
    });
  });

  test("refuses a long detail, a made-up name and a half-finished row", async () => {
    for (const [what, stmt] of [
      ["a detail over 300 characters", tx => tx`insert into job_runs (job, finished_at, ok, detail) values ('classify', now(), true, ${"x".repeat(301)})`],
      ["a name that is not a job's", tx => tx`insert into job_runs (job) values ('Drop Table')`],
      ["an outcome with no end", tx => tx`insert into job_runs (job, ok) values ('classify', true)`],
      ["an end with no outcome", tx => tx`insert into job_runs (job, finished_at) values ('classify', now())`],
    ])
      await assert.rejects(() => inRollback(stmt), /violates check constraint/, what);
  });
});

describe("app_errors", () => {
  test("counts the same error in the same hour on one row", async () => {
    await inRollback(async (tx) => {
      for (let i = 0; i < 3; i++) await tx.unsafe(APP_ERROR_UPSERT, ["/[locale]/test-route", "123", APP_ERRORS_PER_HOUR]);
      await tx.unsafe(APP_ERROR_UPSERT, ["/[locale]/test-route", "", APP_ERRORS_PER_HOUR]);
      const rows = await tx`
        select digest, count, hour = date_trunc('hour', now(), 'UTC') as this_hour
          from app_errors where route = '/[locale]/test-route' order by digest`;
      assert.deepEqual(
        rows.map((r) => [r.digest, r.count, r.this_hour]),
        [
          ["", 1, true],
          ["123", 3, true],
        ],
      );
    });
  });

  test("an hour that is full takes no new rows, but still counts the ones it has", async () => {
    await inRollback(async (tx) => {
      const cap = 3;
      await tx`delete from app_errors where hour = date_trunc('hour', now(), 'UTC')`;
      for (const r of ["/a", "/b", "/c", "/d"]) await tx.unsafe(APP_ERROR_UPSERT, [r, "", cap]);
      await tx.unsafe(APP_ERROR_UPSERT, ["/a", "", cap]);
      const rows = await tx`
        select route, count from app_errors where hour = date_trunc('hour', now(), 'UTC') order by route`;
      assert.deepEqual(
        rows.map((r) => [r.route, r.count]),
        [
          ["/a", 2],
          ["/b", 1],
          ["/c", 1],
        ],
      );
    });
  });

  test("the hour means the same in any session time zone", async () => {
    await inRollback(async (tx) => {
      await tx`set local time zone 'Asia/Kolkata'`;
      await tx.unsafe(APP_ERROR_UPSERT, ["/tz-test", "", APP_ERRORS_PER_HOUR]);
      const [row] = await tx`
        select extract(minute from hour at time zone 'UTC')::int as minute from app_errors where route = '/tz-test'`;
      assert.equal(row.minute, 0, "an hour cut in a half-hour zone would start at :30 in UTC");
    });
  });

  test("refuses a route too long to be a pattern", async () => {
    await assert.rejects(
      () => inRollback((tx) => tx.unsafe(APP_ERROR_UPSERT, ["/" + "x".repeat(250), "", APP_ERRORS_PER_HOUR])),
      /violates check constraint/,
    );
  });
});

describe("the classification queue /api/health reports", () => {
  test("counts what the worker would claim, and nothing it never will", async () => {
    const marker = Symbol("rollback");
    let before;
    let after;
    // One snapshot for both counts, so another session's jobs cannot move them.
    await sql
      .begin("isolation level repeatable read", async (tx) => {
        const queue = async () => (await tx.unsafe(CLASSIFICATION_QUEUE, [QUEUE_MAX_ATTEMPTS, QUEUE_STALE_AFTER]))[0];
        before = await queue();
        const pending = await insertReport(tx, { status: "pending" });
        const rejected = await insertReport(tx, { status: "rejected" });
        const job = (report, status, attempts, { leaseMinutes = 0, hoursOld = 1 } = {}) => tx`
          insert into classification_jobs (report_id, status, attempts, created_at, updated_at)
          values (${report.id}, ${status}, ${attempts},
                  now() - ${hoursOld} * interval '1 hour', now() - ${leaseMinutes} * interval '1 minute')`;
        await job(pending, "queued", 0); // claimed
        await job(pending, "failed", 2); // claimed again
        await job(pending, "running", 1, { leaseMinutes: 10 }); // a lease gone stale: claimed again
        await job(pending, "running", 1, { leaseMinutes: 1 }); // a live lease: not
        await job(pending, "failed", QUEUE_MAX_ATTEMPTS); // given up on: not
        await job(pending, "done", 1); // finished: not
        // A rejected report's job is never claimed and never cancelled. Counted,
        // it would be the oldest wait for ever.
        await job(rejected, "queued", 0, { hoursOld: 100_000 });
        await job(rejected, "failed", 1);
        after = await queue();
        throw marker;
      })
      .catch((e) => {
        if (e !== marker) throw e;
      });
    assert.equal(after.waiting - before.waiting, 3);
    assert.ok(after.oldest_seconds < 50_000 * 3600, `oldest ${after.oldest_seconds} s is the rejected report's job`);
  });
});
