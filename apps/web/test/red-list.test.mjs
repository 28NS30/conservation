/**
 * Taiwan's Red List no longer blurs a record by itself. Migration 0029.
 *
 * 0021 blurred every species the Red List rates Vulnerable or worse, as the
 * national biodiversity portal does. On 30 September 2026 the owner decided,
 * from the team's request to blur only protected species with the risk of
 * poaching in mind, that the blur follows the Wildlife Conservation Act's
 * protected list and TaiCOL's sensitivity ratings (Taiwan's poaching-risk
 * list) and not the Red List. 102 records became exact.
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

async function taxon(tx, { rank = "Species", parent = null, redlist = null, sensitivity = null, protectedStatus = null } = {}) {
  const name = binomial();
  const [t] = await tx`
    insert into taxa (taicol_id, parent_taicol_id, scientific_name, rank,
                      is_in_taiwan, redlist, sensitivity, protected_status, taxon_status)
    values (${uid()}, ${parent}, ${rank === "Species" ? name : `${name} minor`}, ${rank},
            true, ${redlist}, ${sensitivity}, ${protectedStatus}, 'accepted')
    returning id, taicol_id`;
  return t;
}

describe("the Red List by itself", () => {
  for (const category of ["NCR", "NEN", "NVU", "RE", "NNT", "NLC"]) {
    test(`${category} adds nothing`, async () => {
      await inRollback(async (tx) => {
        const t = await taxon(tx, { redlist: category });
        const r = await insertReport(tx, { taxonId: t.id });
        assert.equal(r.location_precision, "exact");
      });
    });
  }

  test("on a species, it does not reach its subspecies either", async () => {
    await inRollback(async (tx) => {
      const sp = await taxon(tx, { redlist: "NVU" });
      const ssp = await taxon(tx, { rank: "Subspecies", parent: sp.taicol_id });
      const r = await insertReport(tx, { taxonId: ssp.id });
      assert.equal(r.location_precision, "exact");
    });
  });
});

describe("what still blurs", () => {
  test("a TaiCOL sensitivity rating, with or without a Red List category", async () => {
    await inRollback(async (tx) => {
      const heavy = await taxon(tx, { redlist: "NVU", sensitivity: "重度" });
      assert.equal((await insertReport(tx, { taxonId: heavy.id })).location_precision, "coarse_50km");
      const light = await taxon(tx, { sensitivity: "輕度" });
      assert.equal((await insertReport(tx, { taxonId: light.id })).location_precision, "coarse_10km");
    });
  });

  test("the protected list, rated or not", async () => {
    await inRollback(async (tx) => {
      const t = await taxon(tx, { protectedStatus: "II" });
      assert.equal((await insertReport(tx, { taxonId: t.id })).location_precision, "coarse_10km");
    });
  });
});

describe("the function and the data", () => {
  test("taxon_precision() has no Red List term", async () => {
    const [{ src }] = await sql`select prosrc as src from pg_proc where proname = 'taxon_precision'`;
    assert.doesNotMatch(src, /precision_from_redlist\(/);
  });

  test("the migration loosens only what was decided, and says so if it would do more", () => {
    const text = readFileSync(
      join(import.meta.dirname, "../../../supabase/migrations/0029_blur_protected_species_only.sql"),
      "utf8",
    );
    assert.match(text, /raise exception '0029 would loosen % record\(s\) outside the decision'/);
    assert.match(text, /taxon_precision\(r\.taxon_id\) = 'exact'\s+and binomial_precision\(r\.taxon_id\) = 'exact'/);
  });
});
