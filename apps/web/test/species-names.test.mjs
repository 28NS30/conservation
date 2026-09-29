/**
 * The English name beside the Chinese one (the team's request 8), and search
 * that finds an animal by it.
 *
 * Migration 0015 gave taxa English names and scripts/import-english-names.ts
 * filled them; lib/speciesNames.ts decides how a page shows them. The rule is
 * pinned first as a pure function, then on the pages and the search API, which
 * need the server and the names loaded (CI runs the import after its fixture).
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, BASE_URL } from "./helpers.mjs";
import { speciesNames, speciesLabel } from "../lib/speciesNames.ts";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const TOAD = {
  scientificName: "Duttaphrynus melanostictus",
  commonNameZh: "黑眶蟾蜍",
  commonNameEn: "Asian Common Toad",
};

describe("which name leads", () => {
  test("the page's language first, the other beside it, the binomial after", () => {
    const zh = speciesNames(TOAD, "zh-TW");
    assert.deepEqual(
      [zh.primary.text, zh.other?.text, zh.scientific?.text],
      ["黑眶蟾蜍", "Asian Common Toad", "Duttaphrynus melanostictus"],
    );
    const en = speciesNames(TOAD, "en");
    assert.deepEqual(
      [en.primary.text, en.other?.text, en.scientific?.text],
      ["Asian Common Toad", "黑眶蟾蜍", "Duttaphrynus melanostictus"],
    );
  });

  test("each name carries its language, and only the binomial is italic", () => {
    const n = speciesNames(TOAD, "en");
    assert.deepEqual(
      [n.primary, n.other, n.scientific].map((p) => [p.lang, p.italic]),
      [["en", false], ["zh-Hant", false], ["la", true]],
    );
  });

  test("with no name in the page's language, the binomial leads, not the other language", () => {
    // An English reader should not get a lone Chinese headline, nor a Chinese
    // reader an English one; the other name still follows.
    const noEn = speciesNames({ ...TOAD, commonNameEn: null }, "en");
    assert.equal(noEn.primary.text, TOAD.scientificName);
    assert.equal(noEn.primary.italic, true);
    assert.equal(noEn.other?.text, "黑眶蟾蜍");
    assert.equal(noEn.scientific, null, "the binomial is not repeated");

    const noZh = speciesNames({ ...TOAD, commonNameZh: null }, "zh-TW");
    assert.equal(noZh.primary.text, TOAD.scientificName);
    assert.equal(noZh.other?.text, "Asian Common Toad");
  });

  test("a missing name leaves nothing in its place", () => {
    const n = speciesNames({ scientificName: "Testudo fixtura", commonNameZh: " ", commonNameEn: "" }, "en");
    assert.deepEqual([n.primary.text, n.other, n.scientific], ["Testudo fixtura", null, null]);
    assert.equal(speciesLabel({ scientificName: "Testudo fixtura", commonNameZh: null }, "zh-TW"), "Testudo fixtura");
  });

  test("the plain-text label for titles", () => {
    assert.equal(speciesLabel(TOAD, "zh-TW"), "黑眶蟾蜍 Asian Common Toad");
    assert.equal(speciesLabel(TOAD, "en"), "Asian Common Toad (黑眶蟾蜍)");
  });
});

describe("the pages that name a species ask speciesNames()", () => {
  // The ternaries these replaced led /en with the binomial and set the Chinese
  // in italics. A file that brings one back fails here.
  const FILES = [
    "app/[locale]/(site)/species/(directory)/page.tsx",
    "app/[locale]/(site)/species/[id]/page.tsx",
    "app/[locale]/(site)/species/[id]/opengraph-image.tsx",
    "app/[locale]/page.tsx",
    "app/[locale]/(site)/reports/(list)/page.tsx",
    "app/[locale]/(site)/reports/[id]/page.tsx",
    "app/[locale]/(site)/stats/page.tsx",
    "app/[locale]/(site)/me/page.tsx",
    "components/map/ReportPanel.tsx",
    "components/map/MapFilters.tsx",
    "components/species/SpeciesCard.tsx",
    "components/report/SpeciesPicker.tsx",
    "components/report/SpeciesConfirm.tsx",
    "components/collections/CollectionHub.tsx",
    "components/collections/InvasiveSpeciesList.tsx",
  ];
  for (const f of FILES)
    test(f, () => {
      const src = readFileSync(join(WEB, f), "utf8");
      assert.match(src, /SpeciesName|speciesNames|speciesLabel/);
      assert.doesNotMatch(src, /zhFirst && s\.commonNameZh/);
      assert.doesNotMatch(src, /zh \? sp\.commonNameZh : sp\.scientificName/);
      assert.doesNotMatch(src, /zhFirst/, "a per-page language ternary is back");
    });
});

async function server() {
  const res = await fetch(BASE_URL).catch(() => null);
  return res !== null;
}

async function namesLoaded() {
  const [{ n }] = await sql`select count(*)::int as n from taxa where common_name_en is not null`;
  return n > 0;
}

async function search(q) {
  const res = await fetch(`${BASE_URL}/api/species/search?q=${encodeURIComponent(q)}&filter=all`);
  assert.equal(res.status, 200);
  return (await res.json()).results;
}

describe("search by English name", () => {
  const cases = [
    ["green iguana", "Iguana iguana"],
    ["Green Iguana", "Iguana iguana"],
    ["leopard cat", "Prionailurus bengalensis"],
    ["asian common toad", "Duttaphrynus melanostictus"],
    ["gray heron", "Ardea cinerea"],
    ["grey heron", "Ardea cinerea"],
    ["red-eared slider", "Trachemys scripta elegans"],
  ];
  for (const [q, want] of cases)
    test(`"${q}" finds ${want}`, async (t) => {
      if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
      if (!(await namesLoaded())) return t.skip("English names not imported (npm run import:names-en)");
      const [{ n }] = await sql`
        select count(*)::int as n from taxa
         where scientific_name = ${want} and taxon_status = 'accepted' and is_in_taiwan`;
      if (n === 0) return t.skip(`${want} is not in this database`);
      const results = await search(q);
      assert.ok(
        results.slice(0, 2).some((r) => r.scientificName.startsWith(want)),
        `top results for "${q}": ${results.slice(0, 3).map((r) => r.scientificName).join(", ")}`,
      );
      assert.ok(results[0].commonNameEn, "the result carries its English name");
    });

  test("a word inside a name counts, so 'iguana' finds the Green Iguana", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    if (!(await namesLoaded())) return t.skip("English names not imported");
    const results = await search("iguana");
    assert.ok(results.some((r) => r.scientificName === "Iguana iguana"));
  });

  test("English search still offers accepted names only", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    if (!(await namesLoaded())) return t.skip("English names not imported");
    for (const q of ["leopard cat", "toad", "iguana"]) {
      const ids = (await search(q)).map((r) => r.id);
      if (!ids.length) continue;
      const [{ n }] = await sql`
        select count(*)::int as n from taxa
         where id = any(${ids}) and (taxon_status is distinct from 'accepted' or not is_in_taiwan)`;
      assert.equal(n, 0, `"${q}" offered a name nobody can file under`);
    }
  });
});

describe("the species page", () => {
  test("names the animal in both languages, each marked with its language", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    if (!(await namesLoaded())) return t.skip("English names not imported");
    const [sp] = await sql`
      select id, scientific_name, common_name_zh, common_name_en from taxa
       where common_name_zh is not null and common_name_en is not null
         and taxon_status = 'accepted' and is_in_taiwan and rank = 'Species'
       order by id limit 1`;
    if (!sp) return t.skip("no taxon with both names");
    const slug = `${sp.id}`;
    for (const [path, first, second] of [
      [`/en/species/${slug}`, "en", "zh-Hant"],
      [`/species/${slug}`, "zh-Hant", "en"],
    ]) {
      const res = await fetch(`${BASE_URL}${path}`, { redirect: "follow" });
      assert.equal(res.status, 200, path);
      const html = await res.text();
      const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
      const esc = (s) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");
      const iFirst = h1.indexOf(`lang="${first}"`);
      const iSecond = h1.indexOf(`lang="${second}"`);
      assert.ok(iFirst >= 0 && iSecond > iFirst, `${path}: ${first} name before ${second}`);
      assert.ok(h1.includes(esc(sp.common_name_en)), `${path}: English name in the heading`);
      assert.ok(h1.includes(sp.common_name_zh), `${path}: Chinese name in the heading`);
      // "italic" as a class of its own; "not-italic" is the opposite.
      assert.doesNotMatch(h1, /lang="zh-Hant" class="(?:[^"]*\s)?italic(?:\s[^"]*)?"/, `${path}: Hanzi set in italics`);
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      assert.ok(title.includes(sp.common_name_zh) && title.includes(esc(sp.common_name_en)), `${path}: <title> has both names`);
    }
  });
});
