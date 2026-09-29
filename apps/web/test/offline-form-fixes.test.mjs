/**
 * The report form and the offline queue, held to what the security audit of
 * 29 September 2026 found them doing: no signal read as a refused photo, a
 * rate limit or a vanished upload wearing a sound report down to `failed`, a
 * report filed under whoever signed in next, typed slips that made a saved
 * report unsendable, and a form that lost or hid what the reporter had
 * entered.
 *
 *   node --test test/offline-form-fixes.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql, BASE_URL } from "./helpers.mjs";
import { checkFields, observedInstant, sendableAccuracy } from "../lib/report/fieldChecks.ts";
import {
  errorKey,
  slotOf,
  isNetworkFailure,
  ReportError,
  NETWORK,
  PHOTO_UPLOAD_FAILED,
} from "../lib/report/errors.ts";
import { reportSubmissionSchema } from "@conservation/shared";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const catalogue = (l) => JSON.parse(read("messages", `${l}.json`));
const up = async () => Boolean(await fetch(BASE_URL).catch(() => null));

// In the same local time as the field's value, like the form: CI runs in UTC.
const NOW = new Date("2026-09-30T12:00").getTime();
const ok = { observedAt: "2026-09-30T11:30", email: "", creditName: "" };

describe("typed fields are checked before a report leaves the form", () => {
  test("a cleared or half-typed time names no instant, and does not throw", () => {
    assert.equal(observedInstant(""), null);
    assert.equal(observedInstant("2026-09-"), null);
    assert.equal(typeof observedInstant("2026-09-30T11:30"), "string");
  });

  test("the time must be there, not in the future and not before 1990", () => {
    for (const observedAt of ["", "2026-13-40T99:99", "2027-01-01T00:00", "1989-12-31T12:00"])
      assert.deepEqual(checkFields({ ...ok, observedAt }, NOW), { key: "timeInvalid", slot: "time" }, observedAt);
    assert.equal(checkFields(ok, NOW), null);
  });

  test("an address the server refuses is refused here, beside the field", () => {
    for (const email of ["me@gmail", "not an address", "a@b"])
      assert.deepEqual(checkFields({ ...ok, email }, NOW), { key: "emailInvalid", slot: "contact" }, email);
    assert.equal(checkFields({ ...ok, email: " someone@example.org " }, NOW), null);
  });

  test("a credit with @ is refused here; without a credit field it is not checked", () => {
    assert.deepEqual(checkFields({ ...ok, creditName: "@birder_tw" }, NOW), { key: "creditInvalid", slot: "credit" });
    assert.equal(checkFields({ ...ok, creditName: undefined }, NOW), null);
  });

  test("what passes here passes the server's schema", () => {
    const observedAt = observedInstant("2026-09-01T11:30");
    const r = reportSubmissionSchema.safeParse({
      category: "sighting", page: "wildlife", lng: 121.5, lat: 25, observedAt,
      contactEmail: "someone@example.org", creditName: "林小明", clientNonce: randomUUID(),
    });
    assert.ok(r.success, JSON.stringify(r.error?.issues));
  });

  test("an accuracy the server would refuse is left out, not sent", () => {
    assert.equal(sendableAccuracy(12.6), 13);
    assert.equal(sendableAccuracy(100_000), 100_000);
    assert.equal(sendableAccuracy(250_000), undefined, "an IP-based fix refused the whole report");
    assert.equal(sendableAccuracy(null), undefined);
    assert.equal(sendableAccuracy(-1), undefined);
  });

  test("the form checks before it sends and before it saves", () => {
    const src = read("components", "report", "ReportForm.tsx");
    for (const fn of ["async function submit()", "async function saveOnPhone()"]) {
      const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 700);
      assert.match(body, /if \(!fieldsOk\(\)\) return;/, fn);
    }
    assert.match(src, /accuracyM: sendableAccuracy\(accuracyM\)/);
    assert.doesNotMatch(src, /new Date\(observedAt\)\.toISOString\(\)/, "a cleared time field throws here");
    for (const slot of ["time", "contact", "credit"]) assert.match(src, new RegExp(`errorIn\\("${slot}"\\)`));
  });

  test("each new sentence exists in both languages, in its slot", () => {
    for (const key of ["timeInvalid", "emailInvalid", "creditInvalid", "signed_in_as_someone_else"])
      for (const l of ["en", "zh-TW"])
        assert.equal(typeof catalogue(l).report.errors[key], "string", `${l} ${key}`);
    assert.equal(slotOf("timeInvalid"), "time");
    assert.equal(slotOf("emailInvalid"), "contact");
    assert.equal(slotOf("creditInvalid"), "credit");
    assert.equal(errorKey("signed_in_as_someone_else"), "signed_in_as_someone_else");
  });
});

describe("no signal is not a refused photo", () => {
  test("a network failure is recognised however it arrives", () => {
    assert.ok(isNetworkFailure(new TypeError("Failed to fetch")));
    assert.ok(isNetworkFailure(new DOMException("t", "TimeoutError")));
    assert.ok(isNetworkFailure(new ReportError(NETWORK)));
    assert.ok(!isNetworkFailure(new ReportError(PHOTO_UPLOAD_FAILED)));
    assert.ok(!isNetworkFailure(new Error("x")));
  });

  test("an upload Storage never answered is NETWORK, and has a time limit", () => {
    const src = read("lib", "report", "upload.ts");
    assert.match(src, /StorageUnknownError/);
    assert.match(src, /new ReportError\(neverArrived\(error\) \? NETWORK : PHOTO_UPLOAD_FAILED\)/);
    assert.match(src, /Promise\.race\(\[/);
  });

  test("the form and the queue both upload through it, and read its answer the same way", () => {
    const form = read("components", "report", "ReportForm.tsx");
    const flush = read("lib", "offline", "flush.ts");
    for (const [name, src] of [["form", form], ["flush", flush]]) {
      assert.match(src, /uploadPhoto\(/, name);
      assert.doesNotMatch(src, /uploadToSignedUrl/, `${name} calls Storage directly`);
      assert.match(src, /isNetworkFailure\(e\)/, name);
    }
  });
});

describe("the queue does not wear a sound report down", () => {
  const flush = read("lib", "offline", "flush.ts");

  test("a rate limit costs no attempt and ends the flush", () => {
    assert.match(flush, /const attempts = network \|\| limited \? item\.attempts : item\.attempts \+ 1;/);
    assert.match(flush, /if \(outcome === "limited"\) break;/);
    assert.match(flush, /if \(res\.status === 429\) throw new ReportError\("rate_limited", 429\);/);
  });

  test("photos collected from Storage are uploaded again from the phone, once", () => {
    assert.match(flush, /data\.error === "photo_missing" && !photosRetried && item\.uploadedPaths\.length/);
    assert.match(flush, /return sendOne\(again, getToken, true\);/);
  });

  test("a refused report is not sent again on every flush", () => {
    assert.match(flush, /if \(item\.status === "failed"\) continue;/);
  });

  test("a report discarded mid-send is not filed", () => {
    const check = flush.indexOf("if (!(await getQueued(item.id))) return \"skipped\";");
    assert.ok(check > 0 && check < flush.indexOf('fetch(withBase("/api/reports")'),
      "the discard is only noticed after the report is filed");
    const banner = read("components", "report", "QueueBanner.tsx");
    assert.match(banner, /disabled=\{sendingId === i\.id\}/);
    assert.match(banner, /if \(currentlySending\(\) === i\.id\) return;/);
  });

  test("a receipt links only to a record that has a page", () => {
    const banner = read("components", "report", "QueueBanner.tsx");
    assert.match(banner, /receiptLinkFor\(r\.serverStatus, r\.serverVisible !== false\)/);
    assert.match(flush, /markUploaded\(item\.id, String\(data\.id \?\? ""\), data\.status, data\.visible !== false\)/);
  });
});

describe("a saved report is filed under the account that saved it", () => {
  const nonces = [];
  after(async () => {
    await sql`delete from reports where client_nonce = any(${nonces})`;
  });
  const post = (extra) => {
    const clientNonce = randomUUID();
    nonces.push(clientNonce);
    return fetch(`${BASE_URL}/api/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: "sighting", page: "wildlife", lng: 121.5, lat: 25.0,
        observedAt: new Date().toISOString(), photoPaths: [], clientNonce,
        taxonUnknown: true, ...extra,
      }),
    }).then(async (res) => ({ res, clientNonce, body: await res.json().catch(() => ({})) }));
  };

  test("saved under an account, sent by nobody: it waits", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    await sql`delete from rate_limits where key like 'submit-%'`;
    const { res, body, clientNonce } = await post({ filedBy: randomUUID() });
    assert.equal(res.status, 409);
    assert.equal(body.error, "signed_in_as_someone_else");
    const rows = await sql`select 1 from reports where client_nonce = ${clientNonce}`;
    assert.equal(rows.length, 0, "it was filed anyway");
  });

  test("saved signed out: filed with no reporter", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    await sql`delete from rate_limits where key like 'submit-%'`;
    const { res, clientNonce } = await post({ filedBy: "anonymous" });
    assert.equal(res.status, 201);
    const [row] = await sql`select reporter_id from reports where client_nonce = ${clientNonce}`;
    assert.equal(row.reporter_id, null);
  });

  test("the route holds a signed-in sender to it, and the form records it from the browser's session", () => {
    const route = read("app", "api", "reports", "route.ts");
    assert.match(route, /input\.filedBy !== signedIn/);
    assert.match(route, /const reporterId = input\.filedBy === "anonymous" \? null : signedIn;/);
    const form = read("components", "report", "ReportForm.tsx");
    assert.match(form, /filedBy: await signedInAs\(\)/);
    assert.match(form, /auth\.getSession\(\)/);
  });

  test("the queue waits for its account at no cost", () => {
    const flush = read("lib", "offline", "flush.ts");
    const branch = flush.slice(flush.indexOf('data.error === "signed_in_as_someone_else"'));
    assert.match(branch.slice(0, 400), /attempts: item\.attempts,/);
    assert.match(branch.slice(0, 400), /return "skipped";/);
  });
});

describe("the form keeps what was entered, and shows what it has", () => {
  const form = read("components", "report", "ReportForm.tsx");

  test("one unreadable photo does not drop the others", () => {
    assert.match(form, /Promise\.allSettled\(picked\.map\(preparePhoto\)\)/);
    assert.doesNotMatch(form, /Promise\.all\(picked\.map\(preparePhoto\)\)/);
  });

  test("a second pick cannot pass the photo limit", () => {
    assert.equal((form.match(/disabled=\{preparing\}/g) ?? []).length, 2, "both pickers stay open while a pick is prepared");
    assert.match(form, /MAX_PHOTOS - prev\.length/);
  });

  test("the time field's latest time is this device's, set after it loads", () => {
    assert.match(form, /max=\{maxTime\}/);
    assert.doesNotMatch(form, /max=\{toLocalInput\(new Date\(\)\)\}/);
  });

  test("leaving for the wildlife page asks first when something would be lost", () => {
    const picker = read("components", "report", "SpeciesPicker.tsx");
    assert.match(picker, /hasEntries && !window\.confirm\(t\("notOnListConfirm"\)\)/);
    assert.match(form, /hasEntries=\{/);
    for (const l of ["en", "zh-TW"]) assert.equal(typeof catalogue(l).report.notOnListConfirm, "string", l);
  });

  test("a search that failed says so, and never shows another query's results", () => {
    const picker = read("components", "report", "SpeciesPicker.tsx");
    assert.match(picker, /const visible = q && hitsFor === q \? hits : \[\];/);
    assert.match(picker, /t\("speciesSearchFailed"\)/);
    for (const l of ["en", "zh-TW"]) assert.equal(typeof catalogue(l).report.speciesSearchFailed, "string", l);
  });

  test("the map pins a place set before it loaded, and a resize keeps the pin in view", () => {
    const picker = read("components", "report", "LocationPicker.tsx");
    assert.match(picker, /const now = valueRef\.current;/);
    assert.match(picker, /if \(!valueRef\.current\)\s+h\.map\.fitBounds/);
  });

  test("a focused field scrolls clear of the send bar, however tall it is", () => {
    assert.match(read("app", "globals.css"), /scroll-padding-bottom: calc\(var\(--send-bar-height, 7rem\) \+ 0\.75rem\)/);
    assert.match(form, /--send-bar-height/);
  });
});
