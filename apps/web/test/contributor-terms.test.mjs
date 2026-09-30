/**
 * The contributor terms: each report says how it may be used, who to credit,
 * and whether it may be shared with a research partner. Migration 0017,
 * /terms, CONSENT_VERSION in packages/shared.
 *
 * Nothing asked before, and a record is exported under the licence it
 * carries or not at all (scripts/dwc-occurrences.ts), so what is stored here
 * is what reaches GBIF. The partner box is PDPA Art. 7's separate consent, and
 * it only exists on the roadkill page.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql, BASE_URL } from "./helpers.mjs";
import { CONSENT_VERSION } from "@conservation/shared";

after(async () => {
  await sql`delete from reports where client_nonce = any(${nonces})`;
  await sql.end();
});

const nonces = [];

async function server() {
  return (await fetch(BASE_URL).catch(() => null)) !== null;
}

async function submit(body) {
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
      ...body,
    }),
  });
  const [row] = await sql`
    select license, rights_holder, share_partners, consent_version, consent_at
      from reports where client_nonce = ${clientNonce}`;
  return { status: res.status, row };
}

describe("what a report stores", () => {
  test("the licence, the credit and the consent, as answered", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const { status, row } = await submit({
      license: "cc-by-4.0", creditName: "  Owl Kid  ", sharePartners: true, consentVersion: "2026-09-29",
    });
    assert.equal(status, 201);
    assert.equal(row.license, "https://creativecommons.org/licenses/by/4.0/legalcode");
    assert.equal(row.rights_holder, "Owl Kid");
    assert.equal(row.share_partners, true);
    assert.equal(row.consent_version, "2026-09-29");
    assert.ok(row.consent_at, "when it was given");
  });

  test("CC0 is stored as CC0", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const { row } = await submit({ license: "cc0-1.0" });
    assert.equal(row.license, "https://creativecommons.org/publicdomain/zero/1.0/legalcode");
    assert.equal(row.rights_holder, null);
  });

  test("the partner box counts only on the page that shows it", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const { status, row } = await submit({
      category: "sighting", page: "wildlife", license: "cc-by-4.0", sharePartners: true,
    });
    assert.equal(status, 201);
    assert.equal(row.share_partners, false, "a live sighting is outside what TaiRON takes");
  });

  test("a report from before the terms carries no licence, and so is never exported under one", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const { status, row } = await submit({});
    assert.equal(status, 201);
    assert.deepEqual(
      [row.license, row.rights_holder, row.share_partners, row.consent_version, row.consent_at],
      [null, null, false, null, null],
    );
  });

  test("an email address is not a credit name", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const { status } = await submit({ license: "cc-by-4.0", creditName: "me@example.com" });
    assert.equal(status, 400);
  });

  test("whether someone shared with a partner is not public", async () => {
    const cols = (
      await sql`select column_name from information_schema.columns where table_name = 'reports_public'`
    ).map((c) => c.column_name);
    for (const c of ["share_partners", "consent_version", "consent_at", "contact_email"])
      assert.ok(!cols.includes(c), `reports_public exposes ${c}`);
  });
});

describe("the pages", () => {
  test("/terms states its version in both languages, and the footer links it", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    for (const [path, word] of [["/terms", "通報者條款"], ["/en/terms", "Terms for contributors"]]) {
      const res = await fetch(`${BASE_URL}${path}`);
      assert.equal(res.status, 200, path);
      const html = await res.text();
      assert.ok(html.includes(word), path);
      assert.match(html, new RegExp(CONSENT_VERSION));
      assert.match(html, /href="(\/en)?\/terms"/, `${path}: footer links /terms`);
    }
  });

  test("the roadkill page offers the partner box, unticked; the others do not", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const roadkill = await (await fetch(`${BASE_URL}/en/report/roadkill`)).text();
    // ">" before the words: rendered text, not the message catalogue the page
    // also ships to the browser, which holds every string of the form.
    assert.match(roadkill, />Also share this record, with its exact location, with TaiRON/);
    assert.doesNotMatch(roadkill, /type="checkbox"[^>]*checked/, "the partner box starts unticked");
    // Every report is CC0 (team request, 30 September 2026): no licence to
    // choose and no credit to give.
    assert.doesNotMatch(roadkill, /type="radio"[^>]*name="license"/, "a licence is still offered");
    assert.doesNotMatch(roadkill, /id="creditName"/, "a credit is still asked for");
    assert.match(roadkill, />Everything you file is published as open data under CC0/);
    for (const kind of ["wildlife", "invasive"]) {
      const html = await (await fetch(`${BASE_URL}/en/report/${kind}`)).text();
      assert.doesNotMatch(html, />Also share this record, with its exact location, with TaiRON/, kind);
      assert.match(html, />How this record may be used</, kind);
    }
  });
});
