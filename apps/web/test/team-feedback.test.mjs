/**
 * The team's feedback of 30 September 2026, held so it stays done: Chinese by
 * default, the site presented as the team's, one photo picker, the location
 * taken from the photo, open data with no credit, and the identification
 * offered as soon as a photo is added.
 *
 *   node --test test/team-feedback.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql, BASE_URL, requireServer } from "./helpers.mjs";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const catalogue = (l) => JSON.parse(read("messages", `${l}.json`));
describe("Chinese unless someone chooses English", () => {
  test("language detection is off", () => {
    assert.match(read("i18n", "routing.ts"), /localeDetection: false/);
  });

  test("an English-language browser gets the Chinese page at an unprefixed address", async (t) => {
    if (!(await requireServer(t))) return;
    const res = await fetch(`${BASE_URL}/report`, { headers: { "accept-language": "en-US,en;q=0.9" }, redirect: "manual" });
    assert.equal(res.status, 200, `redirected to ${res.headers.get("location")}`);
    assert.match(await res.text(), /<html[^>]*lang="zh-TW"/);
  });
});

describe("the site is the team's", () => {
  test("no page says one person runs it", () => {
    for (const l of ["en", "zh-TW"]) {
      const c = catalogue(l);
      for (const [key, text] of [["home.whoBody", c.home.whoBody], ["about.contactBody", c.about.contactBody], ["privacy.contactBody", c.privacy.contactBody]])
        assert.doesNotMatch(text, /Neo Su/, `${l} ${key}`);
    }
  });
});

describe("the photo step", () => {
  const form = read("components", "report", "ReportForm.tsx");

  test("one picker, which on a phone offers the camera too", () => {
    assert.doesNotMatch(form, /^\s+capture=/m, "an input still opens the camera alone");
    assert.equal((form.match(/type="file"/g) ?? []).length, 1);
    for (const l of ["en", "zh-TW"]) {
      assert.equal(typeof catalogue(l).report.photoAdd, "string", l);
      assert.equal(catalogue(l).report.photoTake, undefined, l);
    }
  });

  // That the photo's place fills the location, and the form says so, is run
  // in a browser by e2e/photo.spec.mjs; the line it reads must exist in both.
  test("the line saying the place came from the photo is in both languages", () => {
    for (const l of ["en", "zh-TW"]) assert.equal(typeof catalogue(l).report.locationFromPhoto, "string", l);
  });

  test("the privacy page says the place is filled in, not only offered", () => {
    assert.doesNotMatch(catalogue("en").privacy.photosBody, /never applied automatically/);
    assert.doesNotMatch(catalogue("zh-TW").privacy.photosBody, /絕不會自動套用/);
  });
});

describe("open data, no credit", () => {
  const form = read("components", "report", "ReportForm.tsx");

  test("every report from the form is CC0, and no credit is asked", () => {
    assert.match(form, /const license: ContributorLicense = "cc0-1\.0";/);
    assert.doesNotMatch(form, /name="license"|id="creditName"|setCreditName/);
  });

  test("the terms say so, under a new version", async () => {
    const { CONSENT_VERSION } = await import("@conservation/shared");
    assert.equal(CONSENT_VERSION, "2026-09-30");
    assert.match(catalogue("en").terms.licenceBody, /CC0/);
    assert.doesNotMatch(catalogue("en").terms.licenceBody, /CC BY 4\.0, the default/);
  });
});

describe("the identification, as soon as a photo is added", () => {
  // The form asks about the first photo, once, and never offline: run in a
  // browser by e2e/photo.spec.mjs.

  // What is offered (nothing under 1%, nothing off the page, nothing from the
  // low band), the challenge, the budgets and the site's cap are run against
  // a stand-in model in test/identify.test.mjs.

  test("the route stores nothing", () => {
    const route = read("app", "api", "identify", "route.ts");
    assert.doesNotMatch(route, /storage|report_photos|insert into/i, "the identify route stores something");
  });

  test("it answers malformed requests before any model is asked", async (t) => {
    if (!(await requireServer(t))) return;
    const post = (body) =>
      fetch(`${BASE_URL}/api/identify`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal((await post("not json")).status, 400);
    assert.equal((await post(JSON.stringify({ page: "nowhere", imageBase64: "AAAA" }))).status, 400);
    assert.equal((await post(JSON.stringify({ page: "wildlife", imageBase64: "not base64!" }))).status, 400);
    // One character past the base64 of the largest upload the route takes.
    const { MAX_UPLOAD_BYTES } = await import("@conservation/shared");
    const maxBase64 = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
    assert.equal((await post(JSON.stringify({ page: "wildlife", imageBase64: "A".repeat(maxBase64 + 4) }))).status, 400);
  });

  test("a species picked from the photo's suggestions is blurred as a photo identification", async (t) => {
    if (!(await requireServer(t))) return;
    // A species whose binomial has a stricter row than its own (a protected
    // subspecies beside it): named from a photo, it takes that row's blur.
    const [taxon] = await sql`
      select t.id, binomial_precision_floor(t.id) as floor
        from taxa t
       where t.taxon_status is not distinct from 'accepted' and t.is_in_taiwan
         and t.rank = 'Species' and t.kingdom = 'Animalia'
         and binomial_precision_floor(t.id) is not null
       limit 1`;
    if (!taxon) return t.skip("no species here has a stricter row under its binomial");
    const nonces = [randomUUID(), randomUUID()];
    try {
      await sql`delete from rate_limits where key like 'submit-%'`;
      for (const [nonce, fromPhoto] of [[nonces[0], true], [nonces[1], undefined]]) {
        const res = await fetch(`${BASE_URL}/api/reports`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category: "sighting", page: "wildlife", lng: 121.5, lat: 25.0,
            observedAt: new Date().toISOString(), photoPaths: [], clientNonce: nonce,
            taxonId: taxon.id, taxonFromPhoto: fromPhoto,
          }),
        });
        assert.equal(res.status, 201);
      }
      const rows = await sql`select client_nonce, precision_override from reports where client_nonce = any(${nonces})`;
      const by = Object.fromEntries(rows.map((r) => [r.client_nonce, r.precision_override]));
      assert.equal(by[nonces[0]], taxon.floor, "a photo pick took the species' own rule");
      assert.equal(by[nonces[1]], null, "a searched name took a photo's floor");
    } finally {
      await sql`delete from reports where client_nonce = any(${nonces})`;
    }
  });
});
