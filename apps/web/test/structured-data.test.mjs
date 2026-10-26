/**
 * What the site says about itself to a search engine, as schema.org JSON-LD
 * (lib/structuredData.ts), and that saying it cannot break the page.
 *
 * A search for the project's own name found nothing, and the records could
 * not appear in Google's Dataset Search because nothing described them as a
 * dataset. The home page now states the site and the team, /attribution the
 * dataset, and each species page its taxon.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUTOR_LICENSES } from "@conservation/shared";
import { sql, BASE_URL, requireServer } from "./helpers.mjs";
import { serializeJsonLd } from "../lib/jsonLd.ts";

after(() => sql.end());

/**
 * Every ld+json block on a page, parsed. The block is cut at the first
 * `</script`, as a browser cuts it, so a value that broke out of the element
 * would fail to parse here rather than pass.
 */
async function blocks(path) {
  const html = await (await fetch(`${BASE_URL}${path}`, { redirect: "follow" })).text();
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script/g)].map((m) => JSON.parse(m[1]));
}

const nodes = (b) => b.flatMap((x) => x["@graph"] ?? [x]);
const ofType = (b, type) => nodes(b).filter((n) => n["@type"] === type);

describe("serializeJsonLd", () => {
  test("cannot close the script element it is written into", () => {
    const hostile = { name: "</script><script>alert(1)</script>", other: "a & b > c", sep: "x\u2028y\u2029z" };
    const out = serializeJsonLd(hostile);
    assert.doesNotMatch(out, /<|>|&/);
    assert.doesNotMatch(out, /[\u2028\u2029]/);
    assert.deepEqual(JSON.parse(out), hostile, "the escape changed the data");
  });
});

describe("the home page", () => {
  test("names the site and the team who run it, in each language", async (t) => {
    if (!(await requireServer(t))) return;
    for (const [path, name, other] of [
      ["/", "福爾摩沙守望計畫", "Project FormosaWatch"],
      ["/en", "Project FormosaWatch", "福爾摩沙守望計畫"],
    ]) {
      const b = await blocks(path);
      assert.equal(b[0]?.["@context"], "https://schema.org", path);
      const [site] = ofType(b, "WebSite");
      const [org] = ofType(b, "Organization");
      assert.ok(site && org, `${path}: WebSite and Organization`);
      assert.equal(site.name, name);
      assert.equal(site.alternateName, other);
      assert.equal(org.name, name);
      assert.equal(site.publisher["@id"], org["@id"]);
      assert.ok(new URL(site.url).pathname === (path === "/" ? "/" : "/en"), site.url);
      assert.ok(site.description?.length > 20);
    }
  });
});

describe("/attribution", () => {
  test("describes the records as a schema.org Dataset with what Dataset Search needs", async (t) => {
    if (!(await requireServer(t))) return;
    const [span] = await sql`
      select min(observed_at at time zone 'Asia/Taipei')::date::text as first,
             max(observed_at at time zone 'Asia/Taipei')::date::text as last
        from reports_public`;
    for (const path of ["/attribution", "/en/attribution"]) {
      const b = await blocks(path);
      const [d] = ofType(b, "Dataset");
      assert.ok(d, `${path}: no Dataset`);
      assert.equal(d["@context"], "https://schema.org");
      // Google requires a name and a description of 50 to 5,000 characters.
      assert.ok(d.name?.length > 5, "name");
      assert.ok(d.description?.length >= 50 && d.description.length <= 5000, "description");
      assert.equal(new URL(d.url).pathname, path);
      assert.equal(d.isAccessibleForFree, true);
      // The whole is CC BY 4.0 because TaiRON's records are; the reports filed
      // here are a CC0 part, the licence the report form stores.
      assert.equal(d.license, "https://creativecommons.org/licenses/by/4.0/");
      assert.equal(d.hasPart["@type"], "Dataset");
      assert.equal(d.hasPart.license, "https://creativecommons.org/publicdomain/zero/1.0/");
      assert.ok(CONTRIBUTOR_LICENSES["cc0-1.0"].startsWith(d.hasPart.license));
      // Based on TaiRON's dataset as /attribution links it, under CC BY 4.0.
      assert.equal(d.isBasedOn.url, "https://www.gbif.org/dataset/db09684b-0fd1-431e-b5fa-4c1532fbdb14");
      assert.equal(d.isBasedOn.license, "https://creativecommons.org/licenses/by/4.0/");
      assert.ok(d.isBasedOn.creator?.name);
      // Who made it: the team, as the site names itself.
      assert.equal(d.creator["@type"], "Organization");
      assert.match(d.creator.name, /福爾摩沙守望計畫|Project FormosaWatch/);
      // Where and when: Taiwan, and the first and last day of the public records.
      assert.equal(d.spatialCoverage["@type"], "Place");
      assert.match(d.spatialCoverage.geo.box, /^21\.5 118 26\.5 122\.5$/);
      assert.equal(d.temporalCoverage, `${span.first}/${span.last}`);
      assert.ok(!("distribution" in d), "a download that does not exist");
    }
  });
});

describe("a species page", () => {
  test("describes its taxon as Bioschemas does", async (t) => {
    if (!(await requireServer(t))) return;
    const [s] = await sql`
      select id, scientific_name, taicol_id, common_name_zh from taxa
       where scientific_name = 'Prionailurus bengalensis' and rank = 'Species' limit 1`;
    assert.ok(s, "the fixture lacks 豹貓");
    const b = await blocks(`/species/${s.id}`);
    const [taxon] = ofType(b, "Taxon");
    assert.ok(taxon, "no Taxon");
    assert.equal(taxon.name, s.scientific_name);
    assert.equal(taxon.taxonRank, "species");
    assert.equal(taxon.scientificName.name, s.scientific_name);
    assert.ok(taxon.alternateName.includes(s.common_name_zh));
    assert.equal(taxon.sameAs, `https://taicol.tw/zh-hant/taxon/${s.taicol_id}`);
    assert.equal(taxon.parentTaxon.taxonRank, "genus");
    assert.match(new URL(taxon.url).pathname, new RegExp(`^/species/${s.id}-`));
  });
});
