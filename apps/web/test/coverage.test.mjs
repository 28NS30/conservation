/**
 * The season goal's arithmetic.
 *
 * This is the one number on the site that people are asked to move, which makes
 * its definition load-bearing in a way a descriptive statistic is not. Two
 * properties matter and neither is obvious from reading the query:
 *
 *   1. It counts SQUARES, not records. A second record in a square adds nothing,
 *      which is what stops the target rewarding the same infestation reported
 *      daily — the failure mode of every bounty on finds.
 *   2. It excludes obscured records. A sensitive taxon is published at a 10 km or
 *      50 km cell centre, so crediting it to a 5 km square credits the wrong
 *      square, and would quietly point at the blurred one.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import {
  sql,
  inRollback,
  insertReport,
  taxonWhere,
  BASE_URL,
} from "./helpers.mjs";

after(() => sql.end());

const CELL_M = 5000;

/** The season query's spatial half, runnable inside a rolled-back transaction. */
async function covered(tx) {
  const [row] = await tx`
    with cells as (
      select floor(st_x(geom_3857) / ${CELL_M})::int as gx,
             floor(st_y(geom_3857) / ${CELL_M})::int as gy
        from reports_public
       where not is_obscured
       group by 1, 2
    )
    select count(*)::int as n from cells`;
  return row.n;
}

describe("map coverage", () => {
  test("a second record in the same square does not move the number", async () => {
    await inRollback(async (tx) => {
      const before = await covered(tx);
      // Somewhere in the sea off Taiwan's west coast: guaranteed to be a square
      // nothing else occupies, so the delta is unambiguous.
      const at = { lng: 119.2, lat: 24.1 };
      await insertReport(tx, at);
      const afterFirst = await covered(tx);
      assert.equal(afterFirst, before + 1, "a new square should count once");

      await insertReport(tx, at);
      await insertReport(tx, { ...at, lng: at.lng + 0.001 });
      assert.equal(
        await covered(tx),
        afterFirst,
        "further records in the same square must add nothing",
      );
    });
  });

  test("a record in a different square does move it", async () => {
    await inRollback(async (tx) => {
      const before = await covered(tx);
      await insertReport(tx, { lng: 119.2, lat: 24.1 });
      await insertReport(tx, { lng: 119.4, lat: 24.4 });
      assert.equal(await covered(tx), before + 2);
    });
  });

  test("an obscured record cannot claim a square", async () => {
    await inRollback(async (tx) => {
      // A taxon TaiCOL rates sensitive: the trigger coarsens its location, so
      // its published point is a cell centre tens of kilometres from the truth.
      const sensitive = await taxonWhere("sensitivity is not null");
      const before = await covered(tx);
      const r = await insertReport(tx, {
        taxonId: sensitive,
        lng: 119.2,
        lat: 24.1,
      });
      assert.ok(r.is_obscured, "fixture must actually be obscured");
      assert.equal(
        await covered(tx),
        before,
        "a blurred record must not be credited to a 5 km square",
      );
    });
  });

  test("unpublished records are not counted", async () => {
    await inRollback(async (tx) => {
      const before = await covered(tx);
      await insertReport(tx, { lng: 119.2, lat: 24.1, status: "pending" });
      assert.equal(await covered(tx), before, "pending records are not public");
    });
  });

  test("the season page states the figure and the exclusion", async () => {
    const res = await fetch(`${BASE_URL}/en/season`);
    assert.equal(res.status, 200);
    const html = await res.text();
    // The number the page leads with has to be the one this file describes.
    const n = await covered(sql);
    assert.ok(
      html.includes(n.toLocaleString("en-US")),
      `expected the covered-square count (${n}) on the page`,
    );
    assert.match(
      html,
      /left out of the squares above/,
      "the page must say that obscured records are excluded",
    );
  });
});
