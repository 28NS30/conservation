/**
 * Test reports: a moderator tries the whole path, and nobody else sees it.
 * Migration 0018, app/api/reports/route.ts, the record page and /admin.
 *
 * What would go wrong is quiet. A test that reached reports_public would put a
 * made-up animal on the public map, in /stats, in the export and in a species'
 * count, and would open the season page on its own. A test flag anyone could
 * set would let a stranger file reports that skip being public, which is only
 * odd; a test flag the server ignored would publish a report its sender meant
 * nobody to see, which is worse. So: the view leaves tests out, the route asks
 * the database who is sending, and nothing but the insert writes the flag.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql, BASE_URL, inRollback, insertReport } from "./helpers.mjs";
import { outcomeOf } from "../lib/report/outcome.ts";

const nonces = [];
after(async () => {
  await sql`delete from reports where client_nonce = any(${nonces})`;
  await sql.end();
});

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");

describe("the database leaves test reports out of everything public", () => {
  test("a published test is in reports_published and not in reports_public", async () => {
    await inRollback(async (tx) => {
      const r = await insertReport(tx);
      await tx`update reports set is_test = true where id = ${r.id}`;
      const [pub] = await tx`select count(*)::int as n from reports_public where id = ${r.id}`;
      const [all] = await tx`
        select count(*)::int as n from reports_published where id = ${r.id} and is_test`;
      assert.equal(pub.n, 0, "a test report reached reports_public");
      assert.equal(all.n, 1, "the moderator's view lost the test report");
    });
  });

  test("a species' public count does not include its test reports", async () => {
    await inRollback(async (tx) => {
      const [taxon] = await tx`
        select t.id from taxa t join species_report_stats s on s.taxon_id = t.id
         where t.sensitivity is null limit 1`;
      const count = async () =>
        (await tx`select report_count::int as n from species_report_stats
                   where taxon_id = ${taxon.id}`)[0].n;
      const before = await count();
      const r = await insertReport(tx, { taxonId: taxon.id });
      await tx`update reports set is_test = true where id = ${r.id}`;
      assert.equal(await count(), before);
    });
  });

  test("the two views agree on every real report", async () => {
    // reports_public is reports_published minus tests. If a later migration
    // edits one and not the other, a moderator's test page would stop showing
    // what the public sees; this is where that shows.
    const [diff] = await sql`
      select count(*)::int as n from (
        (select id, location_public::text, location_precision, is_invasive
           from reports_published where not is_test
         except
         select id, location_public::text, location_precision, is_invasive
           from reports_public)
        union all
        (select id, location_public::text, location_precision, is_invasive
           from reports_public
         except
         select id, location_public::text, location_precision, is_invasive
           from reports_published where not is_test)) d`;
    assert.equal(diff.n, 0);
  });

  test("the public role cannot read reports_published", async () => {
    const [row] = await sql`
      select has_table_privilege('web_anon', 'reports_published', 'select') as ok`;
    assert.equal(row.ok, false);
  });

  test("the migration grants nothing on reports_published", () => {
    const src = readFileSync(
      join(WEB, "..", "..", "supabase", "migrations", "0018_test_reports.sql"),
      "utf8",
    );
    assert.doesNotMatch(src, /grant\s+[^;]*\bon\s+reports_published/i);
  });
});

describe("who may send one", () => {
  async function server() {
    return (await fetch(BASE_URL).catch(() => null)) !== null;
  }

  test("a signed-out request for a test is refused, and nothing is stored", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    await sql`delete from rate_limits where key like 'submit-%'`;
    const clientNonce = randomUUID();
    nonces.push(clientNonce);
    const res = await fetch(`${BASE_URL}/api/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: "roadkill",
        page: "roadkill",
        lng: 120.9,
        lat: 23.8,
        observedAt: new Date().toISOString(),
        photoPaths: [],
        clientNonce,
        test: true,
      }),
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "test_not_allowed");
    const [row] = await sql`select count(*)::int as n from reports where client_nonce = ${clientNonce}`;
    assert.equal(row.n, 0, "a refused test was stored anyway");
  });

  test("the route reads the role from the database, not from the request", () => {
    const route = read("app", "api", "reports", "route.ts");
    const gate = route.slice(route.indexOf("const isTest"), route.indexOf("const subject"));
    assert.match(gate, /from profiles where id = \$\{reporterId\}/);
    assert.match(gate, /"moderator"/);
    assert.match(gate, /"admin"/);
    assert.match(gate, /status: 403/);
    // Refused before anything is written: the insert comes much later.
    assert.ok(route.indexOf("const isTest") < route.indexOf("insert into reports"));
  });

  test("only the insert ever writes is_test", () => {
    // A test is safe to confirm to its holder, and a real report never leaves
    // the public view by being relabelled, only because nothing changes the
    // flag after the insert.
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name === "test") continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mjs)$/.test(name) && /set[^;`]*\bis_test\s*=/.test(readFileSync(p, "utf8")))
          offenders.push(p);
      }
    };
    for (const d of ["app", "lib", "components"]) walk(join(WEB, d));
    assert.deepEqual(offenders, []);
  });
});

describe("where a test report can be seen", () => {
  test("only the record page and its title read reports_published", () => {
    const hits = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next") continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, "utf8").includes("reports_published"))
          hits.push(p.slice(WEB.length + 1));
      }
    };
    for (const d of ["app", "lib", "components"]) walk(join(WEB, d));
    // lib/schemaStatus.ts names it only in a health check on the view's definition.
    assert.deepEqual(hits.filter((h) => h !== join("lib", "schemaStatus.ts")), [
      join("app", "[locale]", "(site)", "reports", "[id]", "page.tsx"),
    ]);
  });

  test("the record page reads it for moderators only", () => {
    const page = read("app", "[locale]", "(site)", "reports", "[id]", "page.tsx");
    const path = page.slice(page.indexOf("const viewer ="), page.indexOf("const row = publicRow ?? testRow"));
    assert.match(path, /viewer\.role === "moderator" \|\| viewer\.role === "admin"/);
    assert.match(path, /recordQuery\(sql, id, "tests"\)/);
    const title = page.slice(page.indexOf("async function moderatorSeesTest"));
    assert.match(title.slice(0, title.indexOf("\n}")), /role !== "moderator" && role !== "admin"/);
  });

  test("/me leaves a moderator's tests out of their contributions", () => {
    assert.match(read("app", "[locale]", "(site)", "me", "page.tsx"), /and not r\.is_test/);
  });

  test("the form sends the flag in the payload it also queues offline", () => {
    const form = read("components", "report", "ReportForm.tsx");
    const entered = form.slice(form.indexOf("const entered = "), form.indexOf("async function saveOnPhone"));
    assert.match(entered, /test: test \|\| undefined/);
  });
});

describe("what the sender is told", () => {
  test("a test is never 'on the map'", () => {
    for (const status of ["published", "pending", "rejected"])
      for (const visible of [true, false])
        for (const awaiting of [true, false])
          for (const photos of [0, 1]) {
            const o = outcomeOf(status, awaiting, photos, visible, true);
            assert.equal(o.title, "test");
          }
  });

  test("a published test links to its page; the reason a held one waits is kept", () => {
    assert.deepEqual(outcomeOf("published", false, 1, true, true), {
      title: "test",
      body: "testPublished",
      link: "viewRecord",
    });
    assert.deepEqual(outcomeOf("pending", true, 1, true, true), {
      title: "test",
      body: "heldForIdentification",
      link: "checkStatus",
    });
  });

  test("a real report is answered as before", () => {
    assert.equal(outcomeOf("published", false, 1, true).title, "onMap");
    assert.equal(outcomeOf("published", false, 1, true, false).title, "onMap");
  });

  test("every new sentence exists in both languages", () => {
    const keys = [
      "report.receipt.test",
      "report.receipt.testPublished",
      "report.testMode.title",
      "report.testMode.body",
      "report.testMode.realInstead",
      "report.errors.test_not_allowed",
      "detail.testTitle",
      "detail.testNote",
      "admin.testChip",
      "admin.test.heading",
      "admin.test.body",
      "admin.test.roadkill",
      "admin.test.invasive",
      "admin.test.wildlife",
      "admin.test.recent",
      "admin.test.status.published",
      "admin.test.status.pending",
      "admin.test.status.rejected",
    ];
    for (const locale of ["en", "zh-TW"]) {
      const cat = JSON.parse(read("messages", `${locale}.json`));
      for (const k of keys) {
        const v = k.split(".").reduce((o, p) => o?.[p], cat);
        assert.equal(typeof v, "string", `${locale}: ${k} is missing`);
      }
    }
  });
});
