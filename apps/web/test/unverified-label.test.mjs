/**
 * What a record says about who named its animal, held to what the receipt
 * promised the reporter.
 *
 * The receipt for an invasive-page report says the record "is marked 'not yet
 * verified'" until a moderator checks the species (report.receipt.
 * invasiveNextBody). /me and the queue banner said so; the record itself did
 * not. It showed a tick beside the species and "confirmed by the reporter or a
 * moderator", on a record nobody had checked, and the Darwin Core export calls
 * the same identification "Unverified — reporter's own identification"
 * (scripts/dwc-occurrences.ts). lib/report/verification.ts decides which
 * records carry the mark; these hold the pages to it.
 *
 * Records are inserted for real, because the page reads them on its own
 * connection, and deleted by client nonce afterwards.
 *
 *   TEST_BASE_URL=http://localhost:3000 node --test test/unverified-label.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql, BASE_URL } from "./helpers.mjs";

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const zh = JSON.parse(read("messages", "zh-TW.json"));
const en = JSON.parse(read("messages", "en.json"));

const up = async () => Boolean(await fetch(BASE_URL).catch(() => null));
/**
 * A page as rendered, without its scripts: every page carries the client
 * catalogue in them, so a label's words are always somewhere in the HTML, and
 * only the markup outside the scripts says whether it is shown.
 */
async function shown(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  assert.equal(res.status, 200, `${path} answered ${res.status}`);
  return (await res.text())
    .replace(/<script\b[\s\S]*?<\/script>/g, "")
    // React writes an apostrophe as an entity; the English label has one.
    .replaceAll("&#x27;", "'");
}

const made = [];
after(async () => {
  // In case a test stopped before its own cleanup ran.
  if (made.length) await sql`delete from reports where client_nonce = any(${made})`;
  await sql.end();
});

/** 多線真稜蜥: invasive, unrated, in the CI fixture (supabase/seed-test.sql). */
async function skink() {
  const [t] = await sql`select id from taxa where taicol_id = 't0029144'`;
  assert.ok(t, "t0029144 should be in taxa (local copy or the CI fixture)");
  return t.id;
}

/**
 * A published report, as the form and a moderator leave one, deleted when the
 * test that made it ends.
 *
 * It is committed, so for as long as it exists every other test file running
 * beside this one sees it too: the tile tests count the invasive records in a
 * tile and hold the wildlife collection empty. So each lives only for its own
 * test, and none is a sighting.
 */
async function record(t, { category = "invasive", taxonId, taxonSource }) {
  const nonce = randomUUID();
  made.push(nonce);
  t.after(async () => {
    await sql`delete from reports where client_nonce = ${nonce}`;
  });
  const [row] = await sql`
    insert into reports (category, location, location_public, observed_at, taxon_id, taxon_source,
                         status, source, license, client_nonce)
    values (${category}, st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
            st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography, now() - interval '1 minute',
            ${taxonId}, ${taxonSource}, 'published', 'user',
            'https://creativecommons.org/publicdomain/zero/1.0/', ${nonce})
    returning id::text`;
  return row.id;
}

describe("the receipt's promise", () => {
  test("names the mark in the mark's own words", () => {
    // 「尚未查證」 in the Chinese, “not yet verified” in the English: if either
    // is reworded, the record would no longer carry what the reporter was told.
    const zhQuoted = /「([^」]+)」/.exec(zh.report.receipt.invasiveNextBody)?.[1];
    assert.equal(zhQuoted, zh.report.receipt.notVerified);
    const enQuoted = /“([^”]+)”/.exec(en.report.receipt.invasiveNextBody)?.[1];
    assert.equal(enQuoted?.toLowerCase(), en.report.receipt.notVerified.toLowerCase());
  });

  test("the reporter's own identification is worded as the export words it", () => {
    const dwc = readFileSync(join(WEB, "..", "..", "scripts", "dwc-occurrences.ts"), "utf8");
    const exported = /user: "Unverified — ([^"]+)"/.exec(dwc)?.[1];
    assert.ok(exported, "the export's wording for `user` has moved");
    assert.equal(en.detail.reporterIdentified.toLowerCase(), exported.toLowerCase());
    assert.equal(zh.detail.reporterIdentified, "通報者自行辨識");
  });

  test("and the old blanket claim is gone from both catalogues", () => {
    for (const c of [zh, en]) assert.equal(c.detail.confirmedBy, undefined);
  });
});

describe("the record page keeps it", () => {
  test("a reporter's invasive record is marked, and says who named it", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const id = await record(t, { taxonId: await skink(), taxonSource: "user" });
    const zhPage = await shown(`/reports/${id}`);
    assert.ok(zhPage.includes(zh.report.receipt.notVerified), "the zh record does not say 尚未查證");
    assert.ok(zhPage.includes(zh.detail.reporterIdentified), "the zh record does not say who named it");
    assert.ok(!zhPage.includes("由通報者或審核人員確認"));
    const enPage = await shown(`/en/reports/${id}`);
    assert.ok(enPage.includes(en.report.receipt.notVerified));
    assert.ok(enPage.includes(en.detail.reporterIdentified));
  });

  test("so is one nobody has named", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const id = await record(t, { taxonId: null, taxonSource: null });
    const page = await shown(`/reports/${id}`);
    assert.ok(page.includes(zh.report.receipt.notVerified));
    assert.ok(!page.includes(zh.detail.reporterIdentified), "nobody named it, and the page said the reporter did");
  });

  test("a moderator's identification lifts it", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const id = await record(t, { taxonId: await skink(), taxonSource: "expert" });
    const page = await shown(`/reports/${id}`);
    assert.ok(!page.includes(zh.report.receipt.notVerified), "a confirmed record still says 尚未查證");
    assert.ok(page.includes(zh.detail.moderatorConfirmed));
  });

  test("off the invasive page there is nothing to wait for, but the name is still the reporter's", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const id = await record(t, { category: "roadkill", taxonId: await skink(), taxonSource: "user" });
    const page = await shown(`/reports/${id}`);
    assert.ok(!page.includes(zh.report.receipt.notVerified));
    assert.ok(page.includes(zh.detail.reporterIdentified));
  });
});

describe("and so do the lists that lead to it", () => {
  test("/reports marks the row", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const id = await record(t, { taxonId: await skink(), taxonSource: "user" });
    const page = await shown(`/reports?collection=invasive`);
    const row = page.split("<tr").find((r) => r.includes(`/reports/${id}`));
    assert.ok(row, "the new record is not on the first page of the invasive list");
    assert.ok(row.includes(zh.report.receipt.notVerified), "its row does not say 尚未查證");
  });

  test("the collection pages read the same rule", () => {
    // Statically rendered and revalidated, so a record inserted here is not on
    // them until the next render; the source says they ask.
    const hub = read("components", "collections", "CollectionHub.tsx");
    assert.match(hub, /awaitingVerification\(r\)/);
    assert.match(read("lib", "collections.ts"), /rp\.taxon_source as "taxonSource"/);
  });
});
