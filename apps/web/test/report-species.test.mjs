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

describe("a report nobody has named", () => {
  test("is stamped conservatively even with no photograph", async () => {
    // The stamp used to require a photo, because it keyed on
    // `requiresClassification` — which is `photoCount > 0` — rather than on
    // whether the animal had been named. A no-photo, no-species report was
    // therefore stamped with nothing, and what kept it off the map at full
    // precision was the abuse screen holding it as `pending` for an unrelated
    // reason, plus the trigger's own else-branch since 0011. Neither of those
    // is the submission path deciding, and both can move.
    const { res, body, clientNonce } = await submit({ photoPaths: [] });
    assert.equal(res.status, 201, JSON.stringify(body));

    const row = await stored(clientNonce);
    assert.equal(row.taxon_id, null);
    assert.equal(
      row.precision_override,
      "coarse_10km",
      "an unnamed report must carry its own blur, not borrow one",
    );
    assert.equal(row.location_precision, "coarse_10km");
    assert.equal(row.is_obscured, true);
  });

  test("the receipt still distinguishes 'no photo' from 'not identified yet'", async () => {
    // The stamp changed; the reason shown to the reporter must not. A report
    // with no photograph is held because it has no photograph, and the
    // classifier was never going to look at it.
    const { body } = await submit({ photoPaths: [] });
    assert.equal(
      body.awaitingIdentification,
      false,
      "nothing is waiting to identify a report with no photograph",
    );
  });
});

describe("sending the same report twice", () => {
  test("the answer describes the stored row, not the second request", async () => {
    // `status` and `visible` always came from the existing row;
    // `awaitingIdentification` was recomputed from whatever THIS request
    // carried. So the receipt could describe a hold that had already lifted,
    // or miss one that had not.
    //
    // Making the two disagree needs a stored row with a photograph and a retry
    // without one, and a photograph on the submission path needs signed
    // storage. The row is given one directly instead: `report_photos` is
    // exactly the state a real upload leaves behind, and it is the state the
    // server reads.
    await sql`delete from rate_limits where key like 'submit-%'`;
    const clientNonce = randomUUID();
    nonces.push(clientNonce);
    const body = {
      category: "sighting",
      lng: 120.9,
      lat: 23.8,
      observedAt: new Date().toISOString(),
      photoPaths: [],
      clientNonce,
    };
    const post = () =>
      fetch(`${BASE_URL}/api/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const first = await post();
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    assert.equal(
      firstBody.awaitingIdentification,
      false,
      "no photograph, so nothing was ever going to classify it",
    );

    // Now it has one, and is therefore waiting for the classifier.
    await sql`insert into report_photos (report_id, storage_path, bytes, content_type)
              values (${firstBody.id}, ${`test/${clientNonce}.webp`}, 1234, 'image/webp')`;

    await sql`delete from rate_limits where key like 'submit-%'`;
    const again = await post();
    assert.equal(again.status, 200, "a retry is not a new report");
    const againBody = await again.json();

    assert.equal(againBody.duplicate, true);
    assert.equal(againBody.id, firstBody.id, "the same report, not a second one");
    assert.equal(
      againBody.awaitingIdentification,
      true,
      "the stored row has a photograph and no species, whatever this request carried",
    );
  });

  test("...and once it is identified, it is not waiting any more", async () => {
    await sql`delete from rate_limits where key like 'submit-%'`;
    const clientNonce = randomUUID();
    nonces.push(clientNonce);
    const body = {
      category: "sighting",
      lng: 120.9,
      lat: 23.8,
      observedAt: new Date().toISOString(),
      photoPaths: [],
      clientNonce,
    };
    const post = () =>
      fetch(`${BASE_URL}/api/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const first = await post();
    const firstBody = await first.json();
    await sql`insert into report_photos (report_id, storage_path, bytes, content_type)
              values (${firstBody.id}, ${`test/${clientNonce}-b.webp`}, 1234, 'image/webp')`;

    const taxonId = await taxonWhere(
      "sensitivity is null and protected_status is null and is_in_taiwan",
    );
    // Only the taxon. The row deliberately stays `pending`: publishing it here
    // would put a live `sighting` at 120.9, 23.8 for the length of the run,
    // and tiles.test.mjs asserts that the sighting group is empty because
    // every seeded record is imported roadkill. One test's fixture is another
    // test's premise, and the suite runs its files concurrently.
    await sql`update reports set taxon_id = ${taxonId}, taxon_source = 'expert'
               where client_nonce = ${clientNonce}`;

    await sql`delete from rate_limits where key like 'submit-%'`;
    const againBody = await (await post()).json();
    assert.equal(againBody.status, "pending", "still the row's own status");
    assert.equal(
      againBody.awaitingIdentification,
      false,
      "nothing is waiting to identify a report that has been identified",
    );
  });
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
    // The HOLD is still asserted at source: whether a report waits is only
    // different on one that carries a photograph, and a photograph needs
    // signed storage that a unit test has no business standing up.
    const route = source("app/api/reports/route.ts");
    assert.match(route, /const awaitingId = classifiable && !identified;/);
    assert.match(route, /const status = awaitingId \|\| flaggedReason \? "pending" : "published";/);

    // The BLUR is no longer pinned here, because it no longer needs to be.
    // It used to read `awaitingId ? UNIDENTIFIED_PRECISION : null`, which is
    // photo-dependent and so only observable through storage; keyed on
    // `identified` it is observable from a plain no-photo submission, and
    // "is stamped conservatively even with no photograph" above asserts the
    // behaviour instead of the text. A source pin is a last resort and this
    // one has stopped being necessary.
    assert.match(route, /const precisionOverride = identified \? null : UNIDENTIFIED_PRECISION;/);
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
