/**
 * What /api/health answers, what a job records about its runs and what an
 * error row may hold (lib/monitoring.ts, migration 0036).
 *
 * Health is read by four things that each break differently when it changes:
 * CI waits on its status before testing anything, verify-deploy and the
 * hourly watch read its fields, and the parent site prints its counts. So the
 * shape is pinned here, field by field, and so is when it may be cached: the
 * operator's answer names which privacy rule is missing, and a shared cache
 * that kept it would hand that to the next visitor.
 *
 * The runtime half asks the running server, and skips when there is none.
 *
 *   node --test test/monitoring.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sql, BASE_URL } from "./helpers.mjs";
import {
  JOBS,
  QUEUE_MAX_ATTEMPTS,
  QUEUE_STALE_AFTER,
  activeJobs,
  commitOf,
  errorDetail,
  healthResponse,
  healthUnreachable,
  hours,
  jobDetail,
  memoFor,
  platformWaitUntil,
  requestErrorKey,
} from "../lib/monitoring.ts";
import { LEDGER_UNREADABLE, ledgerCheck, ledgerKept, ledgerMissingName } from "../lib/migrationLedger.ts";
import { LATEST_MIGRATION, MIGRATIONS } from "../lib/latestMigration.ts";
import { migrationFiles } from "../scripts/latest-migration.mjs";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const REPO = join(WEB, "..", "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const up = async () => Boolean(await fetch(BASE_URL).catch(() => null));

const input = (over = {}) => ({
  counts: { reports: 46_334, taxa: 136_680, species: 506 },
  schema: { current: true, missing: [] },
  operator: false,
  authorization: false,
  jobs: ["classify", "cleanup-orphans"],
  jobSeconds: { classify: 3 * 3600 + 7 * 60 },
  queue: { waiting: 2, oldestSeconds: 14 * 60 + 20 },
  storageOk: true,
  dbSizeMb: 412,
  latencyMs: 61,
  commit: "2f13f5e0a1b2",
  ...over,
});

describe("the health answer", () => {
  test("keeps every field its readers read, and adds aggregates only", () => {
    const { status, body } = healthResponse(input());
    assert.equal(status, 200);
    assert.deepEqual(body, {
      ok: true,
      schemaCurrent: true,
      reports: 46_334,
      taxa: 136_680,
      species: 506,
      jobs: { classify: { hoursSinceOk: 3.1 }, "cleanup-orphans": { hoursSinceOk: null } },
      queue: { waiting: 2, oldestMinutes: 14 },
      storage: { ok: true },
      dbSizeMb: 412,
      dbLatencyMs: 61,
      commit: "2f13f5e0a1b2",
    });
  });

  test("names the commit it was built from, or null when that is not known", () => {
    assert.equal(commitOf("2f13f5e0a1b2c3d4e5f60718293a4b5c6d7e8f90"), "2f13f5e0a1b2");
    for (const sha of [undefined, "", "main", "2F13F5E0A1B2C3D4", "2f13f5e"]) assert.equal(commitOf(sha), null, String(sha));
    assert.equal(healthResponse(input({ commit: null })).body.commit, null);
  });

  test("a schema that is not current answers 503, still saying the database answered", () => {
    const { status, body, headers } = healthResponse(
      input({ schema: { current: false, missing: ["0036 job runs and request errors are recorded"] } }),
    );
    assert.equal(status, 503);
    assert.equal(body.ok, true);
    assert.equal(body.schemaCurrent, false);
    assert.equal("schemaMissing" in body, false, "a visitor is never told which rule is missing");
    assert.equal(headers["cache-control"], "private, no-store");
  });

  test("names what is missing to the operator only, and never lets that be cached", () => {
    const { body, headers } = healthResponse(
      input({ operator: true, authorization: true, schema: { current: false, missing: ["0011 x"] } }),
    );
    assert.deepEqual(body.schemaMissing, ["0011 x"]);
    assert.equal(headers["cache-control"], "private, no-store");
  });

  test("is cached by the CDN for 30 seconds only as a plain public 200", () => {
    const pub = healthResponse(input()).headers;
    assert.equal(pub["cache-control"], "public, max-age=0, s-maxage=30");
    assert.equal(pub.vary, "authorization", "a cached public answer must not be served to the operator");
    // Any Authorization header at all, right or wrong, goes to the server.
    assert.equal(healthResponse(input({ authorization: true })).headers["cache-control"], "private, no-store");
    assert.equal(
      healthResponse(input({ operator: true, authorization: true })).headers["cache-control"],
      "private, no-store",
    );
  });

  test("an unreadable part is null or false, not a failure of the whole", () => {
    const { status, body } = healthResponse(input({ jobSeconds: null, queue: null, dbSizeMb: null, storageOk: false }));
    assert.equal(status, 200);
    assert.equal(body.jobs, null);
    assert.equal(body.queue, null);
    assert.equal(body.dbSizeMb, null);
    assert.deepEqual(body.storage, { ok: false });
  });

  test("an empty queue has no oldest", () => {
    assert.deepEqual(healthResponse(input({ queue: { waiting: 0, oldestSeconds: null } })).body.queue, {
      waiting: 0,
      oldestMinutes: null,
    });
  });

  test("an unreachable database answers as it always has, uncached", () => {
    const res = healthUnreachable();
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { ok: false, error: "database_unreachable" });
    assert.equal(res.headers["cache-control"], "private, no-store");
  });

  test("hours are to one decimal, and nothing is a number it is not", () => {
    assert.equal(hours(0), 0);
    assert.equal(hours(5400), 1.5);
    assert.equal(hours(null), null);
    assert.equal(hours(Number.NaN), null);
  });
});

describe("the jobs", () => {
  const crons = JSON.parse(read("vercel.json")).crons.map((c) => c.path.replace("/api/jobs/", ""));

  test("are the crons, by the names they record", () => {
    assert.deepEqual([...JOBS].sort(), [...crons].sort());
  });

  test("the forum's is asked after only while the forum is on", () => {
    assert.deepEqual(activeJobs({}), ["classify", "cleanup-orphans"]);
    assert.deepEqual(activeJobs({ FORUM_ENABLED: "1" }), [...JOBS]);
  });

  for (const job of JOBS) {
    test(`${job} records its run, after the secret is checked`, () => {
      const src = read("app", "api", "jobs", job, "route.ts");
      const at = src.indexOf(`withJobRun("${job}"`);
      assert.notEqual(at, -1, `${job} does not record its run`);
      assert.ok(src.indexOf("if (!authorised(req))") < at, "a row must never be written for a caller without the secret");
    });
  }

  test("the queue counts what the worker would still claim", () => {
    // lib/monitoring.ts CLASSIFICATION_QUEUE repeats the worker's claim; its
    // constants have to be the worker's. test/monitoring-tables.test.mjs runs
    // the statement against jobs of every kind.
    const worker = read("lib", "report", "classifyWorker.ts");
    assert.match(worker, new RegExp(`^const MAX_ATTEMPTS = ${QUEUE_MAX_ATTEMPTS};$`, "m"));
    assert.match(worker, new RegExp(`^const STALE_AFTER = "${QUEUE_STALE_AFTER}";$`, "m"));
    assert.match(worker, /j\.status in \('queued','failed'\)/);
    assert.match(worker, /j\.status = 'running'\s+and j\.updated_at < now\(\) - \$\{STALE_AFTER\}::interval/);
    assert.match(worker, /r\.id = j\.report_id and r\.status <> 'rejected'/);
    assert.match(read("app", "api", "health", "route.ts"), /CLASSIFICATION_QUEUE, \[\s*QUEUE_MAX_ATTEMPTS,\s*QUEUE_STALE_AFTER,?\s*\]/);
  });

  test("cleanup-orphans states its limit and clears the monitoring tables", () => {
    const src = read("app", "api", "jobs", "cleanup-orphans", "route.ts");
    assert.match(src, /^export const maxDuration = 60;$/m);
    assert.match(src, /delete from app_errors where hour < now\(\) - \$\{APP_ERRORS_RETENTION\}::interval/);
    assert.match(src, /delete from job_runs where started_at < now\(\) - \$\{JOB_RUNS_RETENTION\}::interval/);
  });

  test("a run records counts or an error's class, never a message", () => {
    assert.equal(jobDetail('{"claimed":0}'), '{"claimed":0}');
    assert.equal(jobDetail("x".repeat(400)).length, 300);
    const pg = Object.assign(new Error('invalid input syntax for type uuid: "someone@example.test"'), {
      name: "PostgresError",
      code: "22P02",
    });
    assert.equal(errorDetail(pg), "threw PostgresError 22P02");
    assert.equal(errorDetail(Object.assign(new Error("x"), { code: "a b; drop" })), "threw Error");
    assert.equal(errorDetail("a string"), "threw string");
  });
});

describe("an error row", () => {
  test("keeps the route pattern and the digest, nothing from the request", () => {
    assert.deepEqual(
      requestErrorKey({ digest: "2895641102" }, { routePath: "/[locale]/(site)/reports/[id]", routeType: "render" }),
      { route: "/[locale]/(site)/reports/[id]", digest: "2895641102" },
    );
    assert.deepEqual(requestErrorKey(new Error("boom"), { routePath: "/api/reports" }), {
      route: "/api/reports",
      digest: "",
    });
  });

  test("anything that is not plainly a pattern or a digest becomes a fixed word", () => {
    // A path, a query, an address: none is a route pattern.
    for (const routePath of ["/reports/1?email=a@b.test", "reports", "/a b", 42, null, undefined, "/" + "x".repeat(300)])
      assert.equal(requestErrorKey({}, { routePath }).route, "unknown", String(routePath));
    for (const digest of ["has space", "a@b.test", "x".repeat(65), 12345, { a: 1 }])
      assert.equal(requestErrorKey({ digest }, { routePath: "/" }).digest, "other", String(digest));
    assert.equal(requestErrorKey(null, null).route, "unknown");
  });

  test("instrumentation never reads the request, and never throws", () => {
    const src = read("instrumentation.ts");
    assert.match(src, /onRequestError: Instrumentation\.onRequestError = async \(err, _request, context\)/);
    assert.ok(!/_request\./.test(src) && !/_request\[/.test(src), "the request must not be read");
    assert.match(src, /process\.env\.NEXT_RUNTIME !== "nodejs"/);
    assert.match(src, /\} catch \{/);
    // server-only throws outside a server component, which instrumentation is not.
    assert.ok(!/server-only/.test(read("lib", "appErrors.ts").replace(/\/\*[\s\S]*?\*\//g, "")));
  });

  test("instrumentation hands the write to the platform, and still awaits it", () => {
    const code = read("instrumentation.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const body = code.slice(code.indexOf("try {"));
    // Looked up before the first await, while the request's context is current.
    assert.ok(body.indexOf("platformWaitUntil()") < body.indexOf("await"), "waitUntil must be found before anything is awaited");
    assert.match(body, /waitUntil\?\.\(write\);\s*await write;/);
    assert.match(body, /\.catch\(\(\) => \{\}\)/, "the write handed over must never reject");
  });
});

describe("the platform's waitUntil", () => {
  const scope = (name, ctx) => ({ [Symbol.for(name)]: { get: () => ctx } });

  test("is Next.js's request context's, as its after() uses, or else Vercel's", () => {
    for (const name of ["@next/request-context", "@vercel/request-context"]) {
      const handed = [];
      const ctx = { waitUntil(p) { handed.push([this, p]); } };
      const waitUntil = platformWaitUntil(scope(name, ctx));
      const task = Promise.resolve();
      waitUntil(task);
      assert.equal(handed.length, 1, name);
      assert.equal(handed[0][0], ctx, "called on its context");
      assert.equal(handed[0][1], task);
    }
  });

  test("is null where there is none, and nothing about a strange context can throw", () => {
    assert.equal(platformWaitUntil({}), null);
    assert.equal(platformWaitUntil(scope("@next/request-context", undefined)), null);
    assert.equal(platformWaitUntil(scope("@next/request-context", { waitUntil: "no" })), null);
    const throwing = { [Symbol.for("@next/request-context")]: { get: () => { throw new Error("outside a request"); } } };
    assert.equal(platformWaitUntil(throwing), null);
    const refusing = platformWaitUntil(scope("@vercel/request-context", { waitUntil: () => { throw new Error("late"); } }));
    assert.doesNotThrow(() => refusing(Promise.resolve()));
  });
});

describe("health's held answers", () => {
  test("are kept for the time given, shared while in flight, and a failure is not kept", async () => {
    let t = 0;
    let calls = 0;
    let fail = false;
    const held = memoFor(30_000, async () => {
      calls++;
      if (fail) throw new Error("down");
      return calls;
    }, () => t);
    assert.equal(await Promise.all([held(), held()]).then(([a, b]) => a === b && a), 1, "two at once ask once");
    t = 29_999;
    assert.equal(await held(), 1);
    t = 30_000;
    fail = true;
    await assert.rejects(held(), /down/);
    fail = false;
    assert.equal(await held(), 3, "the failure was asked again, not kept");
  });
});

describe("the migration ledger", () => {
  const DIR = join(REPO, "supabase", "migrations");
  const prod = { VERCEL_ENV: "production" };

  test("lib/latestMigration.ts lists every migration file (run `node scripts/latest-migration.mjs`)", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    assert.deepEqual([...MIGRATIONS], migrationFiles(DIR));
    assert.deepEqual([...MIGRATIONS], files, "a .sql file whose name the generator does not take is never asked for");
    assert.equal(LATEST_MIGRATION, files.at(-1));
  });

  test("a number with no file is not asked for: 0020 was never written", () => {
    // Production's ledger has no 0020 either (read 25 October 2026). Were a
    // 0020 written now, out of order, it would simply be one more file asked for.
    assert.equal(MIGRATIONS.some((m) => m.startsWith("0020_")), false);
    assert.ok(MIGRATIONS.includes("0019_forum.sql") && MIGRATIONS.includes("0021_red_list_blur.sql"));
  });

  test("is asked in production only, for every file", () => {
    assert.equal(ledgerKept(prod), true);
    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, { NODE_ENV: "production" }])
      assert.equal(ledgerCheck(MIGRATIONS, env), null, JSON.stringify(env));
    const check = ledgerCheck(MIGRATIONS, prod);
    assert.deepEqual(check.params, [[...MIGRATIONS]]);
    assert.match(check.sql, /unnest\(\$1::text\[\]\)/, "the names are a parameter, not SQL");
  });

  test("refuses a name that is not a migration's", () => {
    assert.throws(() => ledgerCheck(["0036'; drop table x; --.sql"], prod));
    assert.throws(() => ledgerCheck(["0036_x.sql", "README.md"], prod));
    assert.throws(() => ledgerCheck([], prod));
  });

  test("names each missing file to the operator, and an unreadable ledger as such", () => {
    assert.equal(ledgerMissingName("0032_floor_renamed_retired_twins.sql"), "0032_floor_renamed_retired_twins is recorded in the migration ledger");
    assert.equal(typeof LEDGER_UNREADABLE, "string");
  });

  test("its SQL answers with every file the ledger lacks, whatever order they came in", async () => {
    // Names no real migration has, so the database's own rows decide nothing.
    const files = ["9031_a.sql", "9032_b.sql", "9033_c.sql", "9036_d.sql", "9036_e.sql"];
    const check = ledgerCheck(files, prod);
    const marker = Symbol("rollback");
    const answers = [];
    await sql
      .begin(async (tx) => {
        // CI's database has no ledger at all; a laptop's stops wherever the
        // runner last ran. Either way this transaction makes its own rows.
        await tx`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`;
        const missing = async () => (await tx.unsafe(check.sql, check.params))[0].missing;
        answers.push(await missing());
        // The highest first and a lower one later, as branches merge; with
        // and without .sql; and one of two files that share a number.
        await tx`insert into _migrations (name) values ('9036_d.sql'), ('9031_a'), ('9033_c.sql')`;
        answers.push(await missing());
        await tx`insert into _migrations (name) values ('9032_b.sql'), ('9036_e')`;
        answers.push(await missing());
        throw marker;
      })
      .catch((e) => {
        if (e !== marker) throw e;
      });
    assert.deepEqual(answers, [files, ["9032_b.sql", "9036_e.sql"], []]);
  });
});

describe("the running server", () => {
  test("health answers with the new fields, and caches only the public answer", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const res = await fetch(`${BASE_URL}/api/health`);
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.schemaCurrent, true);
    for (const k of ["reports", "taxa", "species", "dbLatencyMs", "dbSizeMb"]) assert.equal(typeof body[k], "number", k);
    assert.deepEqual(Object.keys(body.jobs).sort(), activeJobs({ FORUM_ENABLED: process.env.FORUM_ENABLED }).sort());
    assert.equal(typeof body.queue.waiting, "number");
    assert.equal(typeof body.storage.ok, "boolean");
    assert.ok("commit" in body, "the deploy check reads which build answered");
    assert.equal(res.headers.get("cache-control"), "public, max-age=0, s-maxage=30");

    const authed = await fetch(`${BASE_URL}/api/health`, { headers: { authorization: "Bearer not-the-secret" } });
    assert.equal(authed.headers.get("cache-control"), "private, no-store");
  });

  test("health reports how long ago a job last succeeded", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    // Committed, because the server cannot see another transaction's rows,
    // and removed straight after. Two hours ago, so it can only be this row
    // that a reading near 2 comes from (or a real run since, which is newer).
    const [row] = await sql`
      insert into job_runs (job, started_at, finished_at, ok, detail)
      values ('cleanup-orphans', now() - interval '2 hours 1 minute', now() - interval '2 hours', true, 'monitoring.test')
      returning id`;
    try {
      const body = await (await fetch(`${BASE_URL}/api/health`)).json();
      const h = body.jobs["cleanup-orphans"].hoursSinceOk;
      assert.ok(h !== null && h <= 2.1, `hoursSinceOk ${h}`);
    } finally {
      await sql`delete from job_runs where id = ${row.id}`;
    }
  });

  /** Ask `read` every half second until `ok` holds of its answer, for up to ten seconds. */
  async function eventually(read, ok) {
    let last;
    for (let i = 0; i < 20; i++) {
      last = await read();
      if (ok(last)) return last;
      await new Promise((r) => setTimeout(r, 500));
    }
    return last;
  }

  test("a server error is counted in app_errors, by its route's pattern and nothing else", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const ROUTE = "/api/e2e/server-error";
    const count = async () =>
      (
        await sql`
          select coalesce(sum(count), 0)::int as n from app_errors
           where route = ${ROUTE} and hour = date_trunc('hour', now(), 'UTC')`
      )[0].n;
    const before = await count();
    try {
      const res = await fetch(`${BASE_URL}${ROUTE}?email=someone@example.test`);
      if (res.status === 404) return t.skip("not a test build (NEXT_PUBLIC_E2E unset)");
      assert.equal(res.status, 500);
      // Written through instrumentation.ts onRequestError, after the response.
      const after = await eventually(count, (n) => n > before);
      assert.equal(after, before + 1, "the error was not counted");
      const rows = await sql`select route, digest from app_errors where route = ${ROUTE}`;
      assert.deepEqual(rows.map((r) => [r.route, r.digest]), [[ROUTE, ""]], "a route handler's error has no digest");
      const leaked = await sql`select count(*)::int as n from app_errors where route like '%example.test%' or route like '%?%'`;
      assert.equal(leaked[0].n, 0, "the request's own address was recorded");
    } finally {
      await sql`delete from app_errors where route = ${ROUTE}`;
    }
  });

  test("a job called with the cron secret records a finished run", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const secret = process.env.CRON_SECRET;
    if (!secret) return t.skip("no CRON_SECRET here (CI sets one; a local run may not)");
    const [{ since }] = await sql`select now() as since`;
    // cleanup-orphans: the job whose work is harmless here, deleting only
    // what its own retention says is old. classify would send queued photos
    // to the model.
    const res = await fetch(`${BASE_URL}/api/jobs/cleanup-orphans`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401) return t.skip("the server's CRON_SECRET is not this one");
    const rows = await sql`
      select id, finished_at is not null as finished, ok, detail from job_runs
       where job = 'cleanup-orphans' and started_at >= ${since}`;
    try {
      assert.equal(rows.length, 1, JSON.stringify(rows));
      assert.equal(rows[0].finished, true, "the run's end was not recorded");
      assert.equal(rows[0].ok, res.ok);
      assert.deepEqual(JSON.parse(rows[0].detail), await res.json(), "the detail is the job's own answer");
    } finally {
      if (rows.length) await sql`delete from job_runs where id = any(${rows.map((r) => r.id)})`;
    }
  });
});
