/**
 * The reports a phone sent, findable from that phone.
 *
 * Reporting needs no account and for now only the team can sign in, so for
 * almost every reporter a sent report was never seen again. The phone now
 * keeps the id of each report it sends (lib/offline/sent.ts), /me lists them
 * for a visitor who is signed out, and app/api/receipts says whether each is
 * public, held, or gone — no more than /reports/{id} says to the holder of
 * the id, which is what these hold it to.
 *
 *   node --test test/sent-on-phone.test.mjs
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql, BASE_URL } from "./helpers.mjs";

const read = (...p) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
const catalogue = (l) => JSON.parse(read("messages", `${l}.json`));
const up = async () => Boolean(await fetch(BASE_URL).catch(() => null));

const ROUTE = read("app", "api", "receipts", "route.ts");
const NOTES = "sent-on-phone test marker TAOYUAN-LEOPARD-4417";

const ask = (ids) =>
  fetch(`${BASE_URL}/api/receipts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });

let heldId;
after(async () => {
  if (heldId) await sql`delete from reports where id = ${heldId}::uuid`;
  await sql.end();
});

describe("where each sent report stands", () => {
  before(async () => {
    // Held as the form's own reports are: no photo on a category that expects
    // one. Committed, because the answer comes from the running server.
    const [row] = await sql`
      insert into reports (category, location, location_public, observed_at,
                           notes, status, source, flagged_reason)
      values ('roadkill',
              st_setsrid(st_makepoint(120.95, 23.75), 4326)::geography,
              st_setsrid(st_makepoint(120.95, 23.75), 4326)::geography,
              now(), ${NOTES}, 'pending', 'user',
              'no photo on a category that expects one')
      returning id`;
    heldId = row.id;
  });

  test("public, held and gone, and nothing else", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const [pub] = await sql`select id::text from reports_public limit 1`;
    const [withheld] = await sql`
      select id::text from reports
       where status = 'published' and location_precision = 'suppressed' limit 1`;
    const never = randomUUID();
    const ids = [pub.id, heldId, never, ...(withheld ? [withheld.id] : [])];
    const res = await ask(ids);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ["states"], "the answer is the states and nothing else");
    assert.equal(body.states[pub.id], "public");
    assert.equal(body.states[heldId], "held");
    assert.equal(body.states[never], "gone");
    // Published but never shown: to the holder of the id, the same as gone.
    if (withheld) assert.equal(body.states[withheld.id], "gone");
    assert.ok(!JSON.stringify(body).includes("TAOYUAN"), "the notes reached the answer");
  });

  test("a list that is not ids, or too long, is refused", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    for (const ids of [[], ["not-a-uuid"], [1], Array.from({ length: 51 }, () => randomUUID())])
      assert.equal((await ask(ids)).status, 400, JSON.stringify(ids).slice(0, 60));
    const res = await fetch(`${BASE_URL}/api/receipts`, { method: "POST", body: "nope" });
    assert.equal(res.status, 400);
  });

  test("it reads only what /reports/{id} reads, the same way", () => {
    // The public view as web_anon, and the receipt module for a held one —
    // as a stranger, never as the signed-in reporter.
    assert.match(ROUTE, /asPublic\(/);
    assert.match(ROUTE, /from reports_public where id = any/);
    assert.match(ROUTE, /heldAmong\(/);
    const RECEIPT = read("lib", "receipt.ts");
    const batch = RECEIPT.slice(RECEIPT.indexOf("export async function heldAmong"));
    assert.match(batch, /r\.status === "pending"/, "the list answers only held, as receiptState does to a stranger");
    assert.doesNotMatch(batch, /viewer|reporter_id|rejected/, "the list must never disclose a rejection");
    assert.match(batch, /source = 'user'/);
    assert.doesNotMatch(ROUTE, /import \{[^}]*\bsql\b[^}]*\} from "@\/lib\/db"/, "no privileged read of its own");
    assert.doesNotMatch(ROUTE, /from reports\b(?!_public)/, "the base table is lib/receipt.ts's to read");
  });

  test("it is held to a budget per address, before it reads anything", () => {
    assert.match(ROUTE, /withinBudgets\(\[/);
    assert.match(ROUTE, /addressKey\(clientIp\(req\)\)/);
    assert.ok(ROUTE.indexOf("withinBudgets(") < ROUTE.indexOf("asPublic("));
    assert.doesNotMatch(ROUTE, /for \(const id of wanted\) \{\s*states\[id\] = [^;]*await/, "one read per id again");
  });
});

describe("the phone keeps them, and /me shows them", () => {
  test("a report sent from the form or the queue is written down, and a test is not", () => {
    const form = read("components", "report", "ReportForm.tsx");
    assert.match(form, /if \(!test && data\.test !== true\)\s+void recordSent\(/);
    assert.match(form, /label: species \? speciesLabel\(species, locale\) : null,\s+\}\);/);
    const flush = read("lib", "offline", "flush.ts");
    assert.match(flush, /if \(!item\.payload\.test\)\s+await recordSent\(/);
  });

  test("signed out, /me lists them before the way to sign in", () => {
    const page = read("app", "[locale]", "(site)", "me", "page.tsx");
    const signedOut = page.slice(page.indexOf("if (!user) {"), page.indexOf("const rows ="));
    assert.ok(signedOut.indexOf("<SentOnThisPhone />") > 0);
    assert.ok(signedOut.indexOf("<SentOnThisPhone />") < signedOut.indexOf("signInHref("));
    for (const l of ["en", "zh-TW"])
      for (const k of ["title", "intro", "empty", "public", "held", "gone", "unknown", "forget"])
        assert.equal(typeof catalogue(l).me.phone[k], "string", `${l} me.phone.${k}`);
    assert.equal(catalogue("zh-TW").me.phone.title, "這支手機送出的通報");
  });

  test("signing out forgets them, and any half-written report, but never the queue", () => {
    const forget = read("components", "offline", "ForgetOfflineCopies.tsx");
    assert.match(forget, /void forgetSent\(\);/);
    assert.match(forget, /void forgetDrafts\(\);/);
    assert.doesNotMatch(forget, /removeQueued|pendingReports/);
  });
});

describe("the copy says what is true until email sign-in opens", () => {
  test("/login says, before the form, that only the team can sign in", () => {
    const page = read("app", "[locale]", "(site)", "login", "page.tsx");
    assert.ok(page.indexOf('t("teamOnly")') > 0 && page.indexOf('t("teamOnly")') < page.indexOf("<SignInForm"));
    assert.equal(
      catalogue("zh-TW").login.teamOnly,
      "目前只開放團隊成員登入；通報不需要帳號，你送出的通報會記在這支手機上。",
    );
  });

  test("/about no longer promises that signing in tracks a report", () => {
    for (const l of ["en", "zh-TW"]) {
      const body = catalogue(l).about.contributeBody;
      assert.doesNotMatch(body, /sign in|登入/i, `${l}: ${body}`);
      assert.match(body, /My reports|我的通報/, l);
    }
  });
});
