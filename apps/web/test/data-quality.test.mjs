/**
 * scripts/data-quality.ts: the check run against production after every
 * migration, refresh or remap. Here it runs against this database, and is
 * shown to see what it is for.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql, inRollback, insertReport } from "./helpers.mjs";
import { checkSql, VIOLATIONS } from "../../../scripts/data-quality.ts";

after(() => sql.end());

/**
 * The invariants about records, which hold on any database the migrations
 * built. The floor and retired-twin counts compare the repository's CSV with
 * the taxa a database has, and CI's fixture holds only a slice of them;
 * stricter-wins.test.mjs checks those against the fixture's own taxa.
 */
const RECORD_INVARIANTS = [
  "looser_than_rule",
  "named_by_people_looser_than_binomial",
  "untaxoned_exact",
  "exact_point_moved",
  "blurred_point_not_moved",
  "public_notes_on_blurred",
  "public_test_reports",
];

async function quality(tx = sql) {
  const [{ quality }] = await tx.unsafe(checkSql());
  return quality;
}

describe("the data-quality check", () => {
  test("runs, and every record invariant holds here", async () => {
    const q = await quality();
    for (const k of VIOLATIONS) assert.equal(typeof q[k], "number", `${k} missing`);
    for (const k of RECORD_INVARIANTS) assert.equal(q[k], 0, k);
    assert.ok(q.public > 0 && q.reports >= q.public, JSON.stringify({ public: q.public, reports: q.reports }));
  });

  test("counts a record the trigger did not blur, and a point outside Taiwan", async () => {
    await inRollback(async (tx) => {
      const before = await quality(tx);
      // With triggers off, as a bulk load or a hand edit could leave a row:
      // unnamed and exact, which the trigger would never write.
      const r = await insertReport(tx, {});
      await tx`set local session_replication_role = replica`;
      await tx`update reports set location_precision = 'exact', location_public = location where id = ${r.id}`;
      await tx`set local session_replication_role = origin`;
      // Far from any of the boxes, and on islets inside them.
      await insertReport(tx, { lng: 10, lat: 10 });
      await insertReport(tx, { lng: 122.08, lat: 25.63 }); // 彭佳嶼
      await insertReport(tx, { lng: 119.45, lat: 24.99 }); // 烏坵
      await insertReport(tx, { lng: 120.5, lat: 26.37 }); // 東引
      const after = await quality(tx);
      assert.equal(after.untaxoned_exact - before.untaxoned_exact, 1);
      assert.equal(after.looser_than_rule - before.looser_than_rule, 1);
      assert.equal(after.outside_taiwan - before.outside_taiwan, 1);
    });
  });
});
