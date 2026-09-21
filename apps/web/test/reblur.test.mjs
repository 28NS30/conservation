/**
 * What happens to published records when TaiCOL changes its mind.
 *
 * `set_report_public_location()` fires on `reports.location`, `taxon_id` and
 * `precision_override`. Nothing fired when `taxa.sensitivity` or
 * `taxa.protected_status` changed, because there was no trigger on `taxa` at
 * all — so the blur every record carried was the answer TaiCOL gave on the day
 * that record was written, and a species newly rated sensitive left every
 * existing record of it sitting at its exact coordinate on a public map.
 *
 * Migration 0012. The asymmetry is the design: tightening is automatic,
 * loosening is a decision.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql, inRollback, insertReport } from "./helpers.mjs";

after(() => sql.end());

/** A taxon nothing else in the suite is asserting about, plus one record of it. */
async function taxonWithRecord(tx, { sensitivity = null, protectedStatus = null } = {}) {
  const [t] = await tx`
    insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan,
                      sensitivity, protected_status)
    values (${`test-${Math.abs((Date.now() % 1e9) + Math.floor(performance.now() * 1000))}`},
            'Testus fixtureus', 'Species', true,
            ${sensitivity}, ${protectedStatus})
    returning id`;
  const r = await insertReport(tx, { taxonId: t.id });
  return { taxonId: t.id, report: r };
}

const precisionOf = async (tx, id) =>
  (await tx`select location_precision from reports where id = ${id}`)[0]
    .location_precision;

describe("a taxon newly rated sensitive", () => {
  test("blurs the records already published under it", async () => {
    await inRollback(async (tx) => {
      const { taxonId, report } = await taxonWithRecord(tx);
      assert.equal(report.location_precision, "exact", "unrated to begin with");

      await tx`update taxa set sensitivity = '輕度' where id = ${taxonId}`;

      assert.equal(await precisionOf(tx, report.id), "coarse_10km");
    });
  });

  test("a protected listing counts, with no sensitivity rating at all", async () => {
    await inRollback(async (tx) => {
      const { taxonId, report } = await taxonWithRecord(tx);
      await tx`update taxa set protected_status = 'III' where id = ${taxonId}`;
      assert.equal(await precisionOf(tx, report.id), "coarse_10km");
    });
  });

  test("a rating that tightens further tightens further", async () => {
    await inRollback(async (tx) => {
      const { taxonId, report } = await taxonWithRecord(tx, { sensitivity: "輕度" });
      assert.equal(report.location_precision, "coarse_10km");
      await tx`update taxa set sensitivity = '重度' where id = ${taxonId}`;
      assert.equal(await precisionOf(tx, report.id), "coarse_50km");
    });
  });

  test("the public point actually moves, not just the label", async () => {
    await inRollback(async (tx) => {
      const { taxonId, report } = await taxonWithRecord(tx);
      await tx`update taxa set sensitivity = '輕度' where id = ${taxonId}`;
      const [row] = await tx`
        select st_distance(location, location_public) as m,
               location_public = location as same
          from reports where id = ${report.id}`;
      assert.equal(row.same, false, "the published point is still the true one");
      assert.ok(Number(row.m) > 0, "it did not move");
    });
  });
});

describe("a rating that is withdrawn", () => {
  test("does NOT un-blur what was blurred", async () => {
    // Publishing a location that was withheld is a decision, and a decision is
    // not something an overnight import gets to make. The records keep the
    // precision they have until a person loosens them deliberately.
    await inRollback(async (tx) => {
      const { taxonId, report } = await taxonWithRecord(tx, { sensitivity: "輕度" });
      assert.equal(report.location_precision, "coarse_10km");

      await tx`update taxa set sensitivity = null where id = ${taxonId}`;

      assert.equal(
        await precisionOf(tx, report.id),
        "coarse_10km",
        "an import quietly published a location somebody had withheld",
      );
    });
  });

  test("nor does a rating that merely loosens", async () => {
    await inRollback(async (tx) => {
      const { taxonId, report } = await taxonWithRecord(tx, { sensitivity: "重度" });
      assert.equal(report.location_precision, "coarse_50km");
      await tx`update taxa set sensitivity = '輕度' where id = ${taxonId}`;
      assert.equal(await precisionOf(tx, report.id), "coarse_50km");
    });
  });
});

describe("an import that changes nothing", () => {
  test("changes nothing", async () => {
    await inRollback(async (tx) => {
      const { taxonId, report } = await taxonWithRecord(tx, { sensitivity: "輕度" });
      const [before] = await tx`select location_public::text as p from reports where id = ${report.id}`;
      // What a re-import writes for a row whose rating has not moved.
      await tx`update taxa set sensitivity = '輕度', protected_status = null
                where id = ${taxonId}`;
      const [after] = await tx`select location_public::text as p from reports where id = ${report.id}`;
      assert.equal(after.p, before.p, "the point wandered on a no-op import");
    });
  });
});
