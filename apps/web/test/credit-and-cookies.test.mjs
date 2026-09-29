/**
 * What the site says about the people who contribute, held to what the
 * security audit of 29 September 2026 found: a person's own record never
 * showed the credit their licence asks for, and the privacy page said no
 * cookie is set unless you sign in, when switching language sets one.
 *
 *   node --test test/credit-and-cookies.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql, BASE_URL } from "./helpers.mjs";
import { licenseLabel } from "../lib/license.ts";
import { CONTRIBUTOR_LICENSES } from "@conservation/shared";

after(() => sql.end());

const read = (...p) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
const up = async () => Boolean(await fetch(BASE_URL).catch(() => null));

describe("a person's record carries the credit their licence asks for", () => {
  test("both licences the form offers have a label", () => {
    assert.equal(licenseLabel(CONTRIBUTOR_LICENSES["cc-by-4.0"]), "CC BY 4.0");
    assert.equal(licenseLabel(CONTRIBUTOR_LICENSES["cc0-1.0"]), "CC0 1.0");
  });

  const made = [];
  after(async () => {
    await sql`delete from reports where client_nonce = any(${made})`;
  });

  async function record({ license, credit }) {
    const nonce = randomUUID();
    made.push(nonce);
    // A common, unrated species, so the record is published exactly.
    const [taxon] = await sql`
      select id from taxa where scientific_name = 'Paguma larvata' limit 1`;
    const [row] = await sql`
      insert into reports (category, location, location_public, observed_at, taxon_id, taxon_source,
                           status, source, license, rights_holder, client_nonce)
      values ('roadkill', st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
              st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography, now(),
              ${taxon?.id ?? null}, 'user', 'published', 'user', ${license}, ${credit}, ${nonce})
      returning id::text`;
    return row.id;
  }

  test("the name they gave, and the licence", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const id = await record({ license: CONTRIBUTOR_LICENSES["cc-by-4.0"], credit: "林小明" });
    const html = await fetch(`${BASE_URL}/en/reports/${id}`).then((r) => r.text());
    assert.match(html, /Shared by/);
    assert.match(html, /林小明/);
    assert.match(html, /CC BY 4\.0/);
  });

  test("no name, or CC0: the contributor name the form promises", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const id = await record({ license: CONTRIBUTOR_LICENSES["cc0-1.0"], credit: null });
    const html = await fetch(`${BASE_URL}/en/reports/${id}`).then((r) => r.text());
    assert.match(html, /Shared by/);
    assert.match(html, /FormosaWatch contributor/);
    assert.match(html, /CC0 1\.0/);
  });
});

describe("the privacy page's cookies", () => {
  test("names the language cookie, in both languages", () => {
    const en = JSON.parse(read("messages", "en.json")).privacy.cookiesBody;
    const zh = JSON.parse(read("messages", "zh-TW.json")).privacy.cookiesBody;
    assert.match(en, /switch language/);
    assert.doesNotMatch(en, /only if you choose to sign in/);
    assert.match(zh, /切換語言/);
  });
});
