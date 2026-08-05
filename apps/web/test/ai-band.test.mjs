/**
 * Confidence bands, and what the reporter is actually shown.
 *
 * The classifier has always computed a band, but until 0006_ai_band.sql the
 * worker branched only on 'high' and every other report surfaced the same
 * five suggestions — so a report the model was barely guessing at offered the
 * same confident-looking list as one it nearly got right.
 *
 * Measured on the eval set, the low band's top-5 is 68% against the medium
 * band's 91.6%. A list that is wrong a third of the time does not just waste the
 * reporter's time; it anchors them on a plausible wrong species, and a bad
 * identification is worse for a scientific dataset than no identification. These
 * tests pin that behaviour down.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql, inRollback, insertReport, taxonWhere } from "./helpers.mjs";

after(() => sql.end());

/** Attach fake top-5 predictions to a report. */
async function addSuggestions(tx, reportId, taxonId, n = 5) {
  for (let rank = 1; rank <= n; rank++) {
    await tx`
      insert into classifications (report_id, taxon_id, score, rank, model_version)
      values (${reportId}::uuid, ${taxonId}, ${0.5 / rank}, ${rank}, 'test-v1')`;
  }
}

const suggestionCount = async (tx, reportId) => {
  const [row] = await tx`
    select count(*)::int as n from report_ai_suggestions where report_id = ${reportId}::uuid`;
  return row.n;
};

describe("report_ai_suggestions honours the confidence band", () => {
  test("a low-confidence report offers no suggestions at all", async () => {
    await inRollback(async (tx) => {
      const taxonId = await taxonWhere("is_in_taiwan and sensitivity is null");
      const r = await insertReport(tx, { taxonId: null });
      await addSuggestions(tx, r.id, taxonId);
      await tx`update reports set ai_band = 'low' where id = ${r.id}::uuid`;
      assert.equal(await suggestionCount(tx, r.id), 0, "the low band must show no list");
    });
  });

  test("a medium-confidence report still offers the full top-5", async () => {
    await inRollback(async (tx) => {
      const taxonId = await taxonWhere("is_in_taiwan and sensitivity is null");
      const r = await insertReport(tx, { taxonId: null });
      await addSuggestions(tx, r.id, taxonId);
      await tx`update reports set ai_band = 'medium' where id = ${r.id}::uuid`;
      assert.equal(await suggestionCount(tx, r.id), 5, "the medium band is where the list earns its keep");
    });
  });

  test("reports predating the band column are unaffected", async () => {
    // ai_band is null for every report classified before 0006, and for every
    // non-classifiable category. `is distinct from 'low'` keeps those visible;
    // a plain `<> 'low'` would silently hide all of them.
    await inRollback(async (tx) => {
      const taxonId = await taxonWhere("is_in_taiwan and sensitivity is null");
      const r = await insertReport(tx, { taxonId: null });
      await addSuggestions(tx, r.id, taxonId);
      assert.equal(await suggestionCount(tx, r.id), 5);
    });
  });

  test("the underlying predictions are still recorded in the low band", async () => {
    // Withholding the list must not throw away the record of what the model
    // said — that is what makes comparing model versions possible later.
    await inRollback(async (tx) => {
      const taxonId = await taxonWhere("is_in_taiwan and sensitivity is null");
      const r = await insertReport(tx, { taxonId: null });
      await addSuggestions(tx, r.id, taxonId);
      await tx`update reports set ai_band = 'low' where id = ${r.id}::uuid`;
      const [row] = await tx`
        select count(*)::int as n from classifications where report_id = ${r.id}::uuid`;
      assert.equal(row.n, 5, "classifications rows must survive even when hidden");
    });
  });

  test("suppression still wins over the band", async () => {
    // The privacy rule is not weakened by any of this: a suppressed report
    // exposes nothing regardless of how confident the model was.
    await inRollback(async (tx) => {
      const taxonId = await taxonWhere("is_in_taiwan and sensitivity is null");
      const r = await insertReport(tx, { taxonId: null, override: "suppressed" });
      await addSuggestions(tx, r.id, taxonId);
      await tx`update reports set ai_band = 'high' where id = ${r.id}::uuid`;
      assert.equal(await suggestionCount(tx, r.id), 0);
    });
  });

  test("only the three known bands are accepted", async () => {
    await inRollback(async (tx) => {
      const r = await insertReport(tx, { taxonId: null });
      await assert.rejects(
        () => tx`update reports set ai_band = 'very-sure' where id = ${r.id}::uuid`,
        /violates check constraint/,
      );
    });
  });
});
