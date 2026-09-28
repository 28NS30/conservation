/**
 * A species Taiwan's Red List rates threatened is blurred to at least 10 km.
 * Migration 0021.
 *
 * TaiCOL's sensitivity rating and the protected-species list were the only
 * inputs before, and neither covers every threatened animal: 長腳赤蛙, Nationally
 * Vulnerable, unprotected and unrated, had 46 records at their exact
 * coordinates. The national biodiversity portal already blurs these
 * categories; we were publishing more precisely than it would.
 *
 * Each test builds its own taxa inside a rolled-back transaction, so it
 * asserts the rule, not what TaiCOL says this month.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback, insertReport } from "./helpers.mjs";

after(() => sql.end());

let seq = 0;
const uid = () => `test-rl-${process.pid}-${Date.now()}-${seq++}`;
/** A binomial no real taxon shares, so 0014's sibling rule sees only this test's rows. */
const binomial = () => `Testudoredlist e${process.pid}x${Date.now()}x${seq++}`;

async function taxon(tx, { rank = "Species", parent = null, redlist = null, sensitivity = null } = {}) {
  const name = binomial();
  const [t] = await tx`
    insert into taxa (taicol_id, parent_taicol_id, scientific_name, rank,
                      is_in_taiwan, redlist, sensitivity, taxon_status)
    values (${uid()}, ${parent}, ${rank === "Species" ? name : `${name} minor`}, ${rank},
            true, ${redlist}, ${sensitivity}, 'accepted')
    returning id, taicol_id`;
  return t;
}

const precisionOf = async (tx, id) =>
  (await tx`select location_precision from reports where id = ${id}`)[0].location_precision;

describe("the Red List's threatened categories", () => {
  for (const category of ["NCR", "NEN", "NVU", "RE"]) {
    test(`${category} blurs a record to 10 km`, async () => {
      await inRollback(async (tx) => {
        const t = await taxon(tx, { redlist: category });
        const r = await insertReport(tx, { taxonId: t.id });
        assert.equal(r.location_precision, "coarse_10km");
        assert.equal(r.is_obscured, true);
      });
    });
  }

  // The rule is a list of categories, and a list is easy to widen by accident.
  // Near threatened and the rest are not blurred by this rule; the portal
  // does not blur them either, and blurring every rated species would hide
  // most of the map for no one's protection.
  for (const category of ["NNT", "NLC", "DD", "NA", "NE"]) {
    test(`${category} adds nothing`, async () => {
      await inRollback(async (tx) => {
        const t = await taxon(tx, { redlist: category });
        const r = await insertReport(tx, { taxonId: t.id });
        assert.equal(r.location_precision, "exact");
      });
    });
  }

  test("a stricter rating from elsewhere still wins", async () => {
    await inRollback(async (tx) => {
      const t = await taxon(tx, { redlist: "NVU", sensitivity: "重度" });
      const r = await insertReport(tx, { taxonId: t.id });
      assert.equal(r.location_precision, "coarse_50km");
    });
  });
});

describe("where TaiCOL puts the rating", () => {
  test("on the species, it reaches records filed under a subspecies", async () => {
    // 長腳赤蛙's rating is on its species row.
    await inRollback(async (tx) => {
      const sp = await taxon(tx, { redlist: "NVU" });
      const ssp = await taxon(tx, { rank: "Subspecies", parent: sp.taicol_id });
      const r = await insertReport(tx, { taxonId: ssp.id });
      assert.equal(r.location_precision, "coarse_10km");
    });
  });

  test("on the subspecies, it counts too", async () => {
    // 粉紅鸚嘴's is on the Taiwan subspecies, and its species is unrated.
    await inRollback(async (tx) => {
      const sp = await taxon(tx);
      const ssp = await taxon(tx, { rank: "Subspecies", parent: sp.taicol_id, redlist: "NEN" });
      const r = await insertReport(tx, { taxonId: ssp.id });
      assert.equal(r.location_precision, "coarse_10km");
    });
  });
});

describe("a rating that arrives later", () => {
  test("re-blurs the records already published", async () => {
    // The TaiCOL import writes redlist on every refresh. Without `redlist` in
    // the trigger's column list, a newly listed species would stay exact
    // until something else about it changed.
    await inRollback(async (tx) => {
      const sp = await taxon(tx, { redlist: "NLC" });
      const ssp = await taxon(tx, { rank: "Subspecies", parent: sp.taicol_id });
      const r = await insertReport(tx, { taxonId: ssp.id });
      assert.equal(r.location_precision, "exact", "fixture precondition");

      await tx`update taxa set redlist = 'NVU' where id = ${sp.id}`;
      assert.equal(await precisionOf(tx, r.id), "coarse_10km");
    });
  });

  test("withdrawn, does not un-blur", async () => {
    // Publishing a withheld location is a decision (0012), and a list edit
    // upstream is not that decision.
    await inRollback(async (tx) => {
      const t = await taxon(tx, { redlist: "NEN" });
      const r = await insertReport(tx, { taxonId: t.id });
      assert.equal(r.location_precision, "coarse_10km");

      await tx`update taxa set redlist = 'NLC' where id = ${t.id}`;
      assert.equal(await precisionOf(tx, r.id), "coarse_10km");
    });
  });
});

describe("the data this was written for", () => {
  test("no record of a threatened species is published exactly", async () => {
    // On the local copy this was 102 records before 0021: 長腳赤蛙 46,
    // 粉紅鸚嘴 29, 緬甸蟒 12, 小雲雀 9 and four more.
    const [{ n }] = await sql`
      select count(*)::int as n
        from reports r
        join taxa t on t.id = r.taxon_id
       where r.location_precision = 'exact'
         and (t.redlist in ('NCR', 'NEN', 'NVU', 'RE')
              or exists (select 1 from taxa p
                          where p.taicol_id = t.parent_taicol_id
                            and is_infraspecific(t.rank)
                            and p.redlist in ('NCR', 'NEN', 'NVU', 'RE')))`;
    assert.equal(n, 0);
  });

  test("the migration re-derives through the guarded path", () => {
    // tighten_reports() is the one re-derive that cannot loosen (0014). A bare
    // `update reports set location = location` would re-derive records that
    // are deliberately stricter than their taxon, and could take them down.
    const text = readFileSync(
      join(import.meta.dirname, "../../../supabase/migrations/0021_red_list_blur.sql"),
      "utf8",
    );
    const code = text.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    assert.match(code, /select tighten_reports\(null\);/);
    assert.doesNotMatch(code, /update\s+reports/i);
  });
});
