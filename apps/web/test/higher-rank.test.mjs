/**
 * Records identified only above the species say what they were identified
 * as: 赤蛙科 Ranidae（只辨識到科）, not "Ranidae" (lib/higherRank.ts).
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback } from "./helpers.mjs";
import { higherRankJoin, higherRankLabel, RANK_WORDS } from "../lib/higherRank.ts";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const catalogue = (l) => JSON.parse(readFileSync(join(WEB, "messages", `${l}.json`), "utf8"));

/** next-intl's t, as far as these messages go: a path, and {name}-style values. */
function translator(locale, scope = "") {
  const messages = catalogue(locale);
  return (key, values = {}) => {
    const path = (scope ? `${scope}.${key}` : key).split(".");
    let v = messages;
    for (const p of path) v = v?.[p];
    assert.equal(typeof v, "string", `no message ${path.join(".")}`);
    return v.replace(/\{(\w+)\}/g, (_, k) => values[k]);
  };
}

describe("the label", () => {
  const ranidae = { higherZh: "赤蛙科", higherRank: "Family", higherName: "Ranidae" };

  test("names the group in both languages, and says it went no further", () => {
    assert.equal(higherRankLabel(translator("zh-TW"), "zh-TW", ranidae), "赤蛙科 Ranidae（只辨識到科）");
    assert.equal(higherRankLabel(translator("en"), "en", ranidae), "Ranidae (identified to family only)");
    // A translator already scoped to the detail messages, as the collections' is.
    assert.equal(higherRankLabel(translator("zh-TW", "detail"), "zh-TW", ranidae, ""), "赤蛙科 Ranidae（只辨識到科）");
  });

  test("a rank with no word of its own, and a name with no Chinese, still read", () => {
    const odd = { higherZh: null, higherRank: "Cohort", higherName: "Testia" };
    assert.equal(higherRankLabel(translator("zh-TW"), "zh-TW", odd), "Testia（只辨識到物種以上的分類）");
    assert.equal(higherRankLabel(translator("en"), "en", { ...odd, higherRank: "Genus" }), "Testia (identified to genus only)");
  });

  test("nothing matched is nothing said", () => {
    assert.equal(higherRankLabel(translator("en"), "en", { higherZh: null, higherRank: null, higherName: null }), null);
  });

  test("every rank word exists in both catalogues", () => {
    for (const l of ["zh-TW", "en"])
      for (const r of RANK_WORDS) assert.equal(typeof catalogue(l).detail.rank[r], "string", `${l} ${r}`);
  });
});

describe("the join", () => {
  test("finds the group an unnamed record was published under, and leaves its blur alone", async () => {
    await inRollback(async (tx) => {
      // A family nothing real is called, accepted and in Taiwan, and a record
      // published under it with its authority, as TaiRON wrote names.
      const [fam] = await tx`
        insert into taxa (taicol_id, scientific_name, common_name_zh, rank, taxon_status, is_in_taiwan)
        values ('t9999901', 'Testidae', '測試科', 'Family', 'accepted', true)
        returning id`;
      const rows = await tx`
        insert into reports (category, location, location_public, observed_at, taxon_id,
                             taxon_source, status, source, verbatim_name)
        select 'roadkill', st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
               st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
               now(), null, 'imported', 'published', 'gbif', v.name
          from (values ('Testidae Author, 1900'), ('Testidae'), ('Testidae testensis')) as v(name)
        returning id, verbatim_name, location_precision`;
      for (const r of rows) assert.equal(r.location_precision, "coarse_10km", "an unnamed record is blurred to 10 km");
      const found = await tx`
        select rp.verbatim_name, hr.higher_zh, hr.higher_rank, hr.higher_name
          from reports rp ${higherRankJoin(tx)}
         where rp.id = any(${rows.map((r) => r.id)}::uuid[])
         order by rp.verbatim_name`;
      assert.deepEqual(
        found.map((f) => [f.verbatim_name, f.higher_name, f.higher_zh, f.higher_rank]),
        [
          ["Testidae", "Testidae", "測試科", "Family"],
          ["Testidae Author, 1900", "Testidae", "測試科", "Family"],
          // A binomial is the biologist's to name, not this.
          ["Testidae testensis", null, null, null],
        ],
      );
      const [after] = await tx`select count(*)::int as n from reports where id = any(${rows.map((r) => r.id)}::uuid[]) and taxon_id is not null`;
      assert.equal(after.n, 0, "a record was given a taxon");
      assert.ok(fam.id);
    });
  });

  test("the record page and the collections read it", () => {
    const page = readFileSync(join(WEB, "app", "[locale]", "(site)", "reports", "[id]", "page.tsx"), "utf8");
    assert.match(page, /\$\{higherRankJoin\(tx\)\}/);
    assert.match(page, /higherRankLabel\(t, locale, row\) \?\? row\.verbatim_name \?\? t\("detail\.notYetIdentified"\)/);
    const collections = readFileSync(join(WEB, "lib", "collections.ts"), "utf8");
    assert.match(collections, /\$\{higherRankJoin\(tx\)\}/);
  });
});
