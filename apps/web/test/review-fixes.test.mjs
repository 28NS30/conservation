/**
 * What the review of the security fixes found in them, on 30 September 2026,
 * held so it stays fixed: a record page that scanned all of taxa 25 times per
 * view, restore-breaking trigger functions, a refused photo sent to the GPU
 * five times, budgets a flood from a shared address could spend for everyone,
 * a service worker that evicted the report pages, a saved report filed under
 * no account because the save waited on the network, a Storage hiccup that
 * failed a queued report for good, a credit name that published a place, and
 * a moderator's test that could not show the model's suggestions.
 *
 *   node --test test/review-fixes.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback } from "./helpers.mjs";
import { storedSessionUserId } from "../lib/supabase/storedSession.ts";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");

describe("0028: the binomial lookups are indexed, and the trigger functions pinned", () => {
  test("the index exists", async () => {
    const rows = await sql`select 1 from pg_indexes where indexname = 'taxa_binomial_idx'`;
    assert.equal(rows.length, 1);
  });

  test("the re-blur triggers and the sibling re-blur keep search_path pinned", async () => {
    const rows = await sql`
      select proname, proconfig from pg_proc
       where proname in ('reblur_reports_for_taxon', 'reblur_reports_for_floor', 'tighten_binomial_siblings')`;
    assert.equal(rows.length, 3);
    for (const r of rows) assert.deepEqual(r.proconfig, ["search_path=public"], r.proname);
  });

  test("a binomial lookup can use the index", async () => {
    // Whether it does depends on the table's size: CI's fixture has a few
    // hundred taxa, which a scan reads faster. With scans priced out, the
    // plan shows whether an index can serve the lookup at all.
    let plan = "";
    await inRollback(async (tx) => {
      await tx`set local enable_seqscan = off`;
      plan = (await tx`
        explain select 1 from taxa where binomial_of(scientific_name) = 'paguma larvata'`).map((r) => r["QUERY PLAN"]).join("\n");
    });
    assert.match(plan, /taxa_binomial_idx/);
  });
});

describe("the classifier retires a refused photograph for good", () => {
  test("its job's attempts go to the maximum, so the claim never takes it again", () => {
    const src = read("lib", "report", "classifyWorker.ts");
    assert.match(src, /attempts = \$\{err instanceof ModelRefused \? sql`greatest\(attempts, \$\{MAX_ATTEMPTS\}\)` : sql`attempts`\}/);
    assert.match(src, /j\.attempts < \$\{MAX_ATTEMPTS\}/, "the claim no longer checks attempts");
  });
});

describe("budgets are charged in order, after the challenge", () => {
  const keys = [];
  after(async () => {
    await sql`delete from rate_limits where key = any(${keys})`;
  });

  test("a request the short window refuses is not counted against the long one", async () => {
    // withinBudgets itself imports the app's database module, so its rule is
    // replayed here on bump_rate_limit, the function it calls.
    const burst = `test-burst-${process.pid}-${Date.now()}`;
    const daily = `test-daily-${process.pid}-${Date.now()}`;
    keys.push(burst, daily);
    for (let i = 0; i < 10; i++) {
      const [{ ok }] = await sql`select bump_rate_limit(${burst}, 3600, 2) as ok`;
      if (ok) await sql`select bump_rate_limit(${daily}, 86400, 100)`;
    }
    const [{ n }] = await sql`select coalesce(sum(count), 0)::int as n from rate_limits where key = ${daily}`;
    assert.equal(n, 2, "the day was charged for requests the burst refused");
    const abuse = read("lib", "abuse.ts");
    assert.match(abuse, /for \(const b of budgets\) \{\s+if \(!\(await withinRateLimit\(b\.key, b\.windowSeconds, b\.budget\)\)\) return false;/);
  });

  test("the report route verifies the challenge before it charges any budget", () => {
    const route = read("app", "api", "reports", "route.ts");
    const challenge = route.indexOf("await verifyTurnstile(");
    const budgets = route.indexOf("await withinBudgets(");
    assert.ok(challenge > 0 && budgets > challenge, "a tokenless request spends the address's budget");
    assert.doesNotMatch(route, /Promise\.all\(checks\)/);
  });

  test("signing gives a signed-in sender's address the same room as reporting does", () => {
    const sign = read("app", "api", "uploads", "sign", "route.ts");
    assert.match(sign, /const factor = userId \? SIGNED_IN_ADDRESS_FACTOR : 1;/);
    assert.match(sign, /sign-burst:user:\$\{userId\}/);
    assert.match(sign, /await withinBudgets\(budgets\)/);
  });
});

describe("the service worker keeps what offline reporting needs", () => {
  const sw = read("public", "sw.js");

  test("the report pages live in a cache that is never trimmed", () => {
    assert.match(sw, /const REPORT = `report-\$\{VERSION\}`;/);
    assert.match(sw, /if \(REPORT_PAGE_PATH\.test\(path\)\) \{\s+event\.respondWith\(networkFirst\(request, REPORT\)\);/);
    assert.match(sw, /const cache = await caches\.open\(REPORT\);/, "warmReportPages writes elsewhere");
    assert.doesNotMatch(sw, /trim\(REPORT/);
  });

  test("Next's RSC payloads and prefetches are never written down", () => {
    assert.match(sw, /request\.headers\.get\("RSC"\) === "1"/);
    assert.match(sw, /request\.headers\.has\("Next-Router-Prefetch"\)/);
    assert.match(sw, /url\.searchParams\.has\("_rsc"\)/);
  });

  test("signing out forgets the report pages too", () => {
    const forget = read("components", "offline", "ForgetOfflineCopies.tsx");
    assert.match(forget, /k\.startsWith\("shell-"\) \|\| k\.startsWith\("report-"\)/);
  });
});

describe("a report saved on the phone names its account without the network", () => {
  const URL_ = "https://abcdefghijklmnop.supabase.co";
  const NAME = "sb-abcdefghijklmnop-auth-token";
  const b64url = (s) => Buffer.from(s).toString("base64url");
  const session = { access_token: "x.y.z", refresh_token: "r", user: { id: "11111111-2222-3333-4444-555555555555" } };

  test("signed out: no session stored", () => {
    assert.equal(storedSessionUserId("NEXT_LOCALE=en; other=1", URL_), null);
    assert.equal(storedSessionUserId("", URL_), null);
  });

  test("the stored session, however @supabase/ssr wrote it", () => {
    const value = `base64-${b64url(JSON.stringify(session))}`;
    assert.equal(storedSessionUserId(`a=1; ${NAME}=${value}`, URL_), session.user.id);
    // Split into chunks when long.
    const cut = Math.floor(value.length / 2);
    assert.equal(
      storedSessionUserId(`${NAME}.0=${value.slice(0, cut)}; ${NAME}.1=${value.slice(cut)}`, URL_),
      session.user.id,
    );
    // Plain JSON, as older versions stored it.
    assert.equal(storedSessionUserId(`${NAME}=${encodeURIComponent(JSON.stringify(session))}`, URL_), session.user.id);
  });

  test("an expired token is still its owner's", () => {
    const token = ["e30", b64url(JSON.stringify({ sub: "99999999-8888-7777-6666-555555555555", exp: 1 })), "s"].join(".");
    const value = `base64-${b64url(JSON.stringify({ access_token: token }))}`;
    assert.equal(storedSessionUserId(`${NAME}=${value}`, URL_), "99999999-8888-7777-6666-555555555555");
  });

  test("a session it cannot read is undefined, not 'nobody'", () => {
    assert.equal(storedSessionUserId(`${NAME}=base64-!!!`, URL_), undefined);
  });

  test("the form asks it, and never waits on the network", () => {
    const form = read("components", "report", "ReportForm.tsx");
    assert.match(form, /storedSessionUserId\(document\.cookie, url\)/);
    assert.doesNotMatch(form, /getSession\(\)/);
  });
});

describe("a Storage hiccup is not a missing photo", () => {
  test("the server answers 503, and the queue retries lost photos whenever it sent some", () => {
    const service = read("lib", "supabase", "service.ts");
    assert.match(service, /if \(error\) throw new StorageUnavailable\(error\.message\);/);
    const route = read("app", "api", "reports", "route.ts");
    assert.match(route, /error: "storage_unavailable" \}, \{ status: 503 \}/);
    const flush = read("lib", "offline", "flush.ts");
    assert.match(flush, /data\.error === "photo_missing" && !photosRetried && photoPaths\.length/);
  });
});

describe("a moderator's test shows what the model said", () => {
  test("its suggestions are read with the view's rules, tests aside", () => {
    const page = read("app", "[locale]", "(site)", "reports", "[id]", "page.tsx");
    assert.match(page, /const suggestions = publicRow\s+\? await asPublic/);
    assert.match(page, /and r\.is_test\s+and suggestions_within_blur\(r\.id, r\.location_precision\)/);
  });
});
