/**
 * A reporter is offered only names TaiCOL still accepts.
 *
 * TaiCOL keeps a retired name as a row marked `deleted`, usually beside the
 * accepted row for the same animal, and nothing here filtered on it. So the
 * invasive list showed 多線南蜥 Mabuya multifasciata beside 多線真稜蜥 Eutropis
 * multifasciata — the name TaiCOL retired it in favour of — as a second
 * invasive lizard, and a reporter could file under either. A retired row need
 * not carry its twin's rating, either, which makes this a privacy rule as well:
 * the deleted 'Dopasia formosensis' row is unrated beside the one the law
 * protects.
 *
 * Records already filed under a retired or out-of-Taiwan name must keep
 * displaying. 138 of TaiRON's records sit on names TaiCOL says do not apply in
 * Taiwan, and the fix for those is moving them, not hiding them.
 *
 * Reports are POSTed for real and deleted by client nonce afterwards, as in
 * report-species.test.mjs.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BASE_URL, sql } from "./helpers.mjs";
import { describeFailure } from "../lib/report/errors.ts";

const nonces = [];

after(async () => {
  if (nonces.length)
    await sql`delete from reports where client_nonce = any(${nonces})`;
  await sql.end();
});

const search = async (params) =>
  (await fetch(`${BASE_URL}/api/species/search?${new URLSearchParams(params)}`)).json();

async function submit(taxonId) {
  await sql`delete from rate_limits where key like 'submit-%'`;
  const clientNonce = randomUUID();
  nonces.push(clientNonce);
  const res = await fetch(`${BASE_URL}/api/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      category: "sighting",
      lng: 120.9,
      lat: 23.8,
      observedAt: new Date().toISOString(),
      photoPaths: [],
      clientNonce,
      taxonId,
    }),
  });
  return { status: res.status, body: await res.json() };
}

/** A row by TaiCOL id, which the CI fixture carries for exactly these tests. */
async function taxon(taicolId) {
  const [t] = await sql`
    select id, scientific_name, common_name_zh, taxon_status, is_in_taiwan
      from taxa where taicol_id = ${taicolId}`;
  assert.ok(t, `${taicolId} should be in taxa (local copy or supabase/seed-test.sql)`);
  return t;
}

describe("the picker, the directory and the map's species search", () => {
  test("do not offer a deleted name beside the one that replaced it", async () => {
    const deleted = await taxon("t0123866"); // 多線南蜥 Mabuya multifasciata
    assert.equal(deleted.taxon_status, "deleted", "fixture precondition");

    const { results } = await search({ q: "多線", filter: "invasive" });
    const names = results.map((r) => r.scientificName);
    assert.ok(names.includes("Eutropis multifasciata"), "the accepted lizard is still offered");
    assert.ok(
      !names.includes("Mabuya multifasciata"),
      "a name TaiCOL has deleted was offered as a second invasive species",
    );
  });

  test("offer a name that has a deleted twin exactly once", async () => {
    const { results } = await search({ q: "Dopasia formosensis", filter: "all" });
    const ids = results
      .filter((r) => r.scientificName === "Dopasia formosensis")
      .map((r) => r.id);
    const accepted = await taxon("t0028707");
    assert.deepEqual(ids, [accepted.id]);
  });

  test("the directory page leaves it out too", async () => {
    const html = await (
      await fetch(`${BASE_URL}/species?${new URLSearchParams({ q: "Mabuya", filter: "all" })}`)
    ).text();
    assert.ok(!html.includes("Mabuya multifasciata"));
  });
});

describe("a report naming a species the picker would not offer", () => {
  test("a deleted name is refused, with its own code", async () => {
    const deleted = await taxon("t0123866");
    const { status, body } = await submit(deleted.id);
    assert.equal(status, 400);
    assert.equal(body.error, "taxon_not_accepted");
  });

  test("so is a name TaiCOL says is not found in Taiwan", async () => {
    // Dopasia harti: accepted, but for the Fujian animal.
    const abroad = await taxon("t0124472");
    assert.equal(abroad.is_in_taiwan, false, "fixture precondition");
    const { status, body } = await submit(abroad.id);
    assert.equal(status, 400);
    assert.equal(body.error, "taxon_not_accepted");
  });

  test("an accepted Taiwan species still goes through", async () => {
    const ok = await taxon("t0028707");
    const { status, body } = await submit(ok.id);
    assert.equal(status, 201, JSON.stringify(body));
  });

  test("the reporter is told beside the species picker, in words", () => {
    // report-errors.test.mjs checks that every code the route can send has a
    // sentence in both catalogues; this is where it goes.
    assert.deepEqual(describeFailure("taxon_not_accepted"), {
      key: "taxon_not_accepted",
      slot: "species",
    });
  });
});

describe("what is already filed under such a name", () => {
  test("its species page still renders", async () => {
    const deleted = await taxon("t0123866");
    const res = await fetch(`${BASE_URL}/species/${deleted.id}`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes(deleted.scientific_name));
  });

  test("and so does one for a name not found in Taiwan", async () => {
    const abroad = await taxon("t0124472");
    const res = await fetch(`${BASE_URL}/species/${abroad.id}`);
    assert.equal(res.status, 200);
  });
});
