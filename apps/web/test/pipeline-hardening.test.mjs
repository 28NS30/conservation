/**
 * The submission pipeline and the pages around it, held to what the security
 * audit of 29 September 2026 found them doing: rate-limit rows that named the
 * sender's address, a photo attachable to any number of reports, a /64 that
 * counted as billions of senders, query strings that 500'd a page, dates
 * counted in UTC on a site whose every day is Taiwan's, and a moderation queue
 * that showed a newest hundred as if it were everything.
 *
 *   node --test test/pipeline-hardening.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql, inRollback, insertReport, BASE_URL } from "./helpers.mjs";
import { networkOf, addressKey } from "../lib/request.ts";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const up = async () => Boolean(await fetch(BASE_URL).catch(() => null));

describe("an address is counted as its network, under a key that is not the address", () => {
  test("an IPv6 address counts as its /64, however it is written", () => {
    const one = networkOf("2001:db8::1");
    for (const same of [
      "2001:db8::2",
      "2001:0db8:0000:0000:ffff::9",
      "2001:DB8:0:0:1:2:3:4",
      "[2001:db8::1]",
      "2001:db8::1%eth0",
    ])
      assert.equal(networkOf(same), one, same);
    assert.notEqual(networkOf("2001:db8:0:1::1"), one, "the next /64 is another network");
  });

  test("an IPv4 address counts as itself, however it is written", () => {
    assert.equal(networkOf("203.0.113.7"), "203.0.113.7");
    assert.equal(networkOf("::ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(networkOf("::FFFF:cb00:7107"), "203.0.113.7");
    assert.notEqual(networkOf("::ffff:203.0.113.8"), networkOf("::ffff:203.0.113.7"),
      "IPv4-mapped addresses collapsed into one budget");
  });

  test("anything that is not an address is counted as itself", () => {
    for (const odd of ["unknown", "1::2::3", "2001:db8::zz", "not an ip"])
      assert.equal(networkOf(odd), odd.toLowerCase());
  });

  test("the key hides the address and changes with the secret", () => {
    const before = process.env.RATE_LIMIT_KEY;
    try {
      process.env.RATE_LIMIT_KEY = "one";
      const k = addressKey("203.0.113.7");
      assert.equal(k.length, 22);
      assert.doesNotMatch(k, /203|113/);
      assert.equal(addressKey("203.0.113.7"), k, "the same address must count against the same budget");
      assert.equal(addressKey("2001:db8::1"), addressKey("2001:db8::abcd"));
      process.env.RATE_LIMIT_KEY = "two";
      assert.notEqual(addressKey("203.0.113.7"), k);
    } finally {
      if (before === undefined) delete process.env.RATE_LIMIT_KEY;
      else process.env.RATE_LIMIT_KEY = before;
    }
  });

  test("both routes count addresses only through addressKey", () => {
    for (const route of [["app", "api", "reports", "route.ts"], ["app", "api", "uploads", "sign", "route.ts"]]) {
      const src = read(...route);
      assert.match(src, /addressKey\(ip\)/, route.join("/"));
      assert.doesNotMatch(src, /withinRateLimit\(`[^`]*\$\{ip\}/, `${route.join("/")} keys a limit by the raw address`);
    }
  });

  test("a signed-in sender is counted by address as well as by account", () => {
    const src = read("app", "api", "reports", "route.ts");
    assert.match(src, /SIGNED_IN_ADDRESS_FACTOR/);
    assert.match(src, /submit-burst:\$\{address\}/);
    assert.match(src, /submit-daily:\$\{address\}/);
  });

  test("a submission leaves no address in rate_limits", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    await sql`delete from rate_limits where key like 'submit-%'`;
    const clientNonce = randomUUID();
    try {
      const res = await fetch(`${BASE_URL}/api/reports`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" },
        body: JSON.stringify({
          category: "sighting", page: "wildlife", lng: 121.5, lat: 25.0,
          observedAt: new Date().toISOString(), photoPaths: [], clientNonce, taxonUnknown: true,
        }),
      });
      assert.equal(res.status, 201);
      const rows = await sql`select key from rate_limits where key like 'submit-%'`;
      assert.ok(rows.length >= 2, "the submission was not counted at all");
      for (const { key } of rows) assert.doesNotMatch(key, /198\.51\.100\.77/, key);
    } finally {
      await sql`delete from reports where client_nonce = ${clientNonce}`;
    }
  });

  test("old rate_limits rows are deleted by the daily cleanup", () => {
    const src = read("app", "api", "jobs", "cleanup-orphans", "route.ts");
    assert.match(src, /delete from rate_limits where window_start < now\(\) - \$\{RATE_LIMIT_RETENTION\}::interval/);
    assert.match(src, /const RATE_LIMIT_RETENTION = "2 days"/);
  });
});

describe("a photograph belongs to one report", () => {
  test("the schema refuses a path attached twice (0027)", async () => {
    await inRollback(async (tx) => {
      const a = await insertReport(tx);
      const b = await insertReport(tx);
      const path = `2026/09/${randomUUID()}.webp`;
      await tx`insert into report_photos (report_id, storage_path) values (${a.id}, ${path})`;
      await assert.rejects(
        tx.savepoint((sp) => sp`insert into report_photos (report_id, storage_path) values (${b.id}, ${path})`),
        (e) => e.code === "23505",
      );
    });
  });

  test("the route refuses a path another report holds, before anything is written", () => {
    const src = read("app", "api", "reports", "route.ts");
    const check = src.indexOf('error: "photo_in_use"');
    assert.ok(check > 0, "no photo_in_use check");
    assert.ok(check < src.indexOf("insert into reports"), "the check runs after the report is written");
    assert.match(src, /client_nonce is distinct from \$\{input\.clientNonce\}/,
      "a retry of the same report would be refused its own photos");
  });

  test("the same path twice in one request is invalid", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    await sql`delete from rate_limits where key like 'submit-%'`;
    const path = `2026/09/${randomUUID()}.webp`;
    const res = await fetch(`${BASE_URL}/api/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: "sighting", page: "wildlife", lng: 121.5, lat: 25.0,
        observedAt: new Date().toISOString(), photoPaths: [path, path],
        clientNonce: randomUUID(), taxonUnknown: true,
      }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "validation_failed");
  });
});

describe("what a URL can make a page do", () => {
  for (const q of ["%00%01abc", "abc&q=def", "x".repeat(3000), "%E0%A4%A"]) {
    test(`the species directory answers ?q=${q.slice(0, 20)}${q.length > 20 ? "…" : ""}`, async (t) => {
      if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
      const res = await fetch(`${BASE_URL}/en/species?q=${q}`);
      assert.ok(res.status === 200 || res.status === 400, `answered ${res.status}`);
    });
  }

  for (const page of ["abc", "-3", "1e9", "2.5", "99999999999999999999"]) {
    test(`the records list answers ?page=${page}`, async (t) => {
      if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
      const res = await fetch(`${BASE_URL}/en/reports?page=${page}`);
      assert.equal(res.status, 200);
    });
  }

  test("a record id that is not a UUID is not found, not an error", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const dashes = "-".repeat(36);
    assert.equal((await fetch(`${BASE_URL}/en/reports/${dashes}`)).status, 404);
    assert.equal((await fetch(`${BASE_URL}/en/reports/0000000g-0000-0000-0000-000000000000`)).status, 404);
    assert.equal((await fetch(`${BASE_URL}/api/reports/${dashes}`)).status, 400);
  });

  test("a date Postgres cannot read is refused, not a 500", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const tile = await fetch(`${BASE_URL}/api/tiles/7/107/55?from=0001-01-01`);
    assert.equal(tile.status, 400);
    assert.equal((await fetch(`${BASE_URL}/en/reports?from=0000-01-01`)).status, 200);
  });

  test("health names no missing rule to a visitor", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    for (const headers of [{}, { authorization: "Bearer not-the-secret" }]) {
      const res = await fetch(`${BASE_URL}/api/health`, { headers });
      const body = await res.json();
      assert.equal("schemaMissing" in body, false);
    }
  });
});

describe("a day is a day in Taiwan", () => {
  test("every date filter and bucket on observed_at is in Taipei time", () => {
    const files = [
      ["app", "[locale]", "(site)", "reports", "(list)", "page.tsx"],
      ["app", "api", "tiles", "[z]", "[x]", "[y]", "route.ts"],
      ["app", "[locale]", "map", "page.tsx"],
      ["lib", "stats.ts"],
      ["lib", "species.ts"],
      ["lib", "collections.ts"],
    ];
    for (const f of files) {
      const src = read(...f);
      const loose = [
        ...src.matchAll(/observed_at\s*(?:>=|<=|<|>)\s*[^\n]*/g),
        ...src.matchAll(/extract\(\w+ from [^)]*observed_at\)?[^\n]*/g),
        ...src.matchAll(/to_char\([^,]*observed_at[^,]*,[^\n]*/g),
      ]
        .map((m) => m[0])
        .filter((line) => !line.includes("Asia/Taipei"));
      assert.deepEqual(loose, [], `${f.join("/")} counts a day in UTC`);
    }
  });

  test("a record seen at 01:30 in Taipei belongs to that Taipei day", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const clientNonce = randomUUID();
    // 17:30 UTC on 1 June is 01:30 on 2 June in Taipei.
    const [row] = await sql`
      insert into reports (category, location, location_public, observed_at, status, source, client_nonce)
      values ('roadkill', st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
              st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
              '2020-06-01T17:30:00Z', 'published', 'user', ${clientNonce})
      returning id::text`;
    try {
      const list = async (day) =>
        (await fetch(`${BASE_URL}/en/reports?from=${day}&to=${day}`)).text();
      assert.ok((await list("2020-06-02")).includes(row.id), "missing from its own Taipei day");
      assert.ok(!(await list("2020-06-01")).includes(row.id), "listed under the UTC day");
    } finally {
      await sql`delete from reports where client_nonce = ${clientNonce}`;
    }
  });
});

describe("moderation", () => {
  test("a report already decided cannot be decided again", () => {
    const src = read("app", "[locale]", "(site)", "admin", "actions.ts");
    const guarded = src.match(/where id = \$\{reportId\}::uuid and status = 'pending'/g) ?? [];
    assert.equal(guarded.length, 2, "publish and reject must each act only on a pending report");
    assert.equal((src.match(/throw new Error\("already decided"\)/g) ?? []).length, 2);
  });

  test("the queue is oldest first and its header counts all of it", () => {
    const src = read("app", "[locale]", "(site)", "admin", "page.tsx");
    assert.match(src, /select count\(\*\)::int as pending from reports where status = 'pending'/);
    assert.match(src, /order by r\.created_at, r\.id\s+limit \$\{QUEUE_PAGE\}/);
    assert.match(src, /t\("pendingCount", \{ count: pending \}\)/);
    for (const l of ["en", "zh-TW"])
      assert.equal(typeof JSON.parse(read("messages", `${l}.json`)).admin.oldestShown, "string", l);
  });

  test("a job that died on its last attempt is retired, held and blurred", () => {
    const src = read("lib", "report", "classifyWorker.ts");
    const sweep = src.indexOf("with stuck as (");
    assert.ok(sweep > 0, "no sweep for abandoned last attempts");
    assert.ok(sweep < src.indexOf("with claimed as ("), "the sweep must run before the next claim");
    const body = src.slice(sweep, src.indexOf("with claimed as ("));
    assert.match(body, /attempts >= \$\{MAX_ATTEMPTS\}/);
    assert.match(body, /stricter_precision\(r\.precision_override,\s+\$\{UNIDENTIFIED_PRECISION\}::text\)/);
    assert.match(body, /coalesce\(r\.flagged_reason, 'classification unavailable'\)/);
  });
});

describe("/me counts every report", () => {
  test("the figures and the journal are not taken from the 200 listed", () => {
    const src = read("app", "[locale]", "(site)", "me", "page.tsx");
    assert.doesNotMatch(src, /rows\.filter\(/, "a figure counted from the listed rows");
    assert.match(src, /count\(\*\) filter \(where status = 'published'\)/);
    assert.match(src, /group by t\.id/);
  });
});

describe("the public role's queries have a time limit", () => {
  test("asPublic sets a statement timeout", () => {
    assert.match(read("lib", "db.ts"), /set local statement_timeout = '\d+s'/);
  });
});
