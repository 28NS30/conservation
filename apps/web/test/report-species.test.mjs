import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { BASE_URL, sql, taxonWhere } from "./helpers.mjs";

/**
 * Naming the species at submission time.
 *
 * The reporter saw the animal; until now only the classifier could say what it
 * was, over a queue, from a photograph. These tests pin the two things that
 * follow from letting the person who was there answer: the report no longer
 * waits to be published, and it still blurs when the species is sensitive.
 *
 * Reports are POSTed for real — the API holds its own connection, so a
 * transaction here could not see them — and deleted by client nonce afterwards.
 */

const nonces = [];

async function submit(body) {
  // These tests file several reports in a few seconds from one address, which is
  // exactly what SUBMIT_LIMITS.burst exists to stop (6 in 120s). Rate limiting
  // has its own coverage; clearing the counter keeps that concern out of these
  // assertions instead of spreading the tests out in wall-clock time.
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
      ...body,
    }),
  });
  return { res, body: await res.json(), clientNonce };
}

const stored = (nonce) =>
  sql`select taxon_id, taxon_source, status, flagged_reason,
             location_precision, is_obscured, precision_override
        from reports where client_nonce = ${nonce}`.then((r) => r[0]);

const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

after(async () => {
  if (nonces.length)
    await sql`delete from reports where client_nonce = any(${nonces})`;
  await sql.end();
});

describe("a reporter names the species", () => {
  test("it is stored as the reporter's own word", async () => {
    const taxonId = await taxonWhere(
      "sensitivity is null and protected_status is null and is_in_taiwan",
    );
    const { res, body, clientNonce } = await submit({ taxonId });

    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.awaitingIdentification, false);

    const row = await stored(clientNonce);
    assert.equal(Number(row.taxon_id), Number(taxonId));
    // Not 'ai' and not 'expert': the same claim as confirming a guess later.
    assert.equal(row.taxon_source, "user");
    // Nothing is being held back for an identification that has already been
    // made. These submissions carry no photograph, which is a separate rule and
    // the only thing still holding them — so the two are asserted apart.
    assert.equal(row.precision_override, null);
    assert.equal(row.flagged_reason, "no photo on a category that expects one");
  });

  test("naming the species is what lifts the identification hold", () => {
    // Asserted at source, because the difference only shows on a report that
    // carries a photograph, and a photograph needs signed storage that a unit
    // test has no business standing up. The rule is one line; pin the line.
    const route = source("app/api/reports/route.ts");
    assert.match(route, /const awaitingId = classifiable && !identified;/);
    assert.match(
      route,
      /const precisionOverride = awaitingId \? UNIDENTIFIED_PRECISION : null;/,
    );
  });

  test("the classifier does not overwrite a person's identification", () => {
    // Without this the reporter's answer survived until the next cron run and
    // was then replaced, taking the published precision with it.
    const job = source("app/api/jobs/classify/route.ts");
    assert.match(job, /job\.taxon_source !== "ai"/);
    assert.match(job, /&& !humanIdentified/);
  });

  test("a sensitive species still blurs, named or not", async () => {
    // The whole privacy boundary in one assertion. Trusting the reporter means
    // publishing what they say; it does not mean publishing where they say it.
    const taxonId = await taxonWhere("sensitivity = '輕度' and is_in_taiwan");
    const { clientNonce } = await submit({ taxonId });

    const row = await stored(clientNonce);
    assert.equal(row.location_precision, "coarse_10km");
    assert.equal(row.is_obscured, true);
  });

  test("an unknown taxon is refused as an answer, not as a crash", async () => {
    const { res, body } = await submit({ taxonId: 999_999_999 });
    assert.equal(res.status, 400);
    assert.equal(body.error, "taxon_not_found");
  });
});

describe("a reporter cannot name it", () => {
  test("'I don't know' is recorded as a judgement, not an absence", async () => {
    const { res, clientNonce } = await submit({ taxonUnknown: true });
    assert.equal(res.status, 201);

    const row = await stored(clientNonce);
    assert.equal(row.taxon_id, null);
    // The distinction this exists for: nobody could name it, versus nobody has
    // looked at it yet, which is taxon_source null.
    assert.equal(row.taxon_source, "unknown");
  });

  test("naming a species and disclaiming one at once is rejected", async () => {
    const taxonId = await taxonWhere("is_in_taiwan and sensitivity is null");
    const { res, body } = await submit({ taxonId, taxonUnknown: true });
    assert.equal(res.status, 400);
    assert.equal(body.error, "validation_failed");
  });
});

describe("the picker's search", () => {
  const search = async (params) =>
    fetch(`${BASE_URL}/api/species/search?${new URLSearchParams(params)}`);

  test("the species actually called that comes first", async () => {
    // 石虎 is the common name of a subspecies with no records and an alternate
    // name of the species holding every leopard cat record we have. Ranking the
    // exact common name first sent a reporter to an empty page.
    const { results } = await (await search({ q: "石虎", filter: "all" })).json();
    assert.equal(results[0].scientificName, "Prionailurus bengalensis");
  });

  test("part of an alternate name is enough to find a species", async () => {
    // TaiCOL stores the iguana as 綠鬛蜥 and the spelling everyone else uses,
    // 綠鬣蜥, only as an alternate. Whole-name matching found it and partial
    // matching found nothing, which is the half a picker needs.
    const { results } = await (await search({ q: "綠鬣", filter: "all" })).json();
    assert.ok(
      results.some((r) => r.scientificName === "Iguana iguana"),
      "expected the green iguana",
    );
  });

  test("the invasive scope is the register, not the checklist", async () => {
    const { results } = await (
      await search({ q: "螺", filter: "invasive" })
    ).json();
    assert.ok(results.length > 0, "expected invasive snails");
    assert.ok(
      results.every((r) => r.isInvasive),
      "the invasive scope must return only invasive taxa",
    );
  });

  test("preferring natives never hides a non-native", async () => {
    // A roadkill victim is very often not native — feral pigeons and mynas are
    // 1,341 of our records — so the preference has to be a ranking.
    const { results } = await (
      await search({ q: "Iguana", filter: "all", prefer: "native" })
    ).json();
    assert.ok(results.some((r) => r.scientificName === "Iguana iguana"));
  });

  test("an unknown preference is rejected", async () => {
    assert.equal((await search({ q: "a", prefer: "nonsense" })).status, 400);
  });
});
