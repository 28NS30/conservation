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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  sql,
  inRollback,
  insertReport,
  taxonWhere,
  BASE_URL,
} from "./helpers.mjs";

after(() => sql.end());

const CELL_M = 5000;

/**
 * The headline number, mirroring lib/coverage.ts.
 *
 * Duplicated SQL rather than an import, because lib/coverage.ts resolves the
 * `@/lib/db` path alias that this runner does not. If the shipped query changes,
 * change this too — these tests are the only thing standing between the site's
 * one call-to-action number and a silent lie.
 */
/**
 * The start of the season as an instant: midnight in Taipei on the quarter's
 * first day. Written once and checked against the shipped query below, since
 * this file can only mirror it.
 */
const SEASON_START =
  "date_trunc('quarter', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei'";

/**
 * The same instant, for fixtures, spelled out on its own rather than taken
 * from SEASON_START: a fixture built from the expression under test would
 * move with it, and prove nothing.
 */
const TAIPEI_QUARTER_START =
  "(date_trunc('quarter', timezone('Asia/Taipei', now())) at time zone 'Asia/Taipei')";

async function newThisSeason(tx) {
  const [row] = await tx`
    with bounds as (
      select ${tx.unsafe(SEASON_START)} as ss
    ),
    cells as (
      select floor(st_x(geom_3857) / ${CELL_M})::int as gx,
             floor(st_y(geom_3857) / ${CELL_M})::int as gy,
             min(case when source = 'gbif' then observed_at else created_at end) as first_at,
             count(*) filter (
               where source = 'user' and created_at >= (select ss from bounds)
             )::int as fresh
        from reports_public
       where not is_obscured
       group by 1, 2
    )
    select count(*) filter (
             where first_at >= (select ss from bounds) and fresh > 0
           )::int as n
      from cells`;
  return row.n;
}

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
  // A square is only claimed by a record whose location is exact, so every
  // fixture that expects the count to MOVE has to be identified. Since 0011 an
  // untaxoned record is blurred — the sensitivity of an unidentified animal is
  // unknown — and blurred records are excluded a few tests below. Planting one
  // here would be testing the blur, not the counting.
  const plain = () => taxonWhere("scientific_name = 'Paguma larvata'");

  test("a second record in the same square does not move the number", async () => {
    await inRollback(async (tx) => {
      const taxonId = await plain();
      const before = await covered(tx);
      // Somewhere in the sea off Taiwan's west coast: guaranteed to be a square
      // nothing else occupies, so the delta is unambiguous.
      const at = { lng: 119.2, lat: 24.1, taxonId };
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
      const taxonId = await plain();
      const before = await covered(tx);
      await insertReport(tx, { lng: 119.2, lat: 24.1, taxonId });
      await insertReport(tx, { lng: 119.4, lat: 24.4, taxonId });
      assert.equal(await covered(tx), before + 2);
    });
  });

  test("an unidentified record cannot claim a square either", async () => {
    // The same rule as the obscured-taxon case below, reached by not knowing
    // the species rather than by knowing a sensitive one.
    await inRollback(async (tx) => {
      const before = await covered(tx);
      const r = await insertReport(tx, { taxonId: null, lng: 119.2, lat: 24.1 });
      assert.ok(r.is_obscured, "an unidentified record must be blurred");
      assert.equal(await covered(tx), before);
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

  test("a report on an already-covered square is not newly reached", async () => {
    // The defect this pins: newness was measured from min(created_at), and the
    // whole TaiRON corpus was bulk-imported inside the current quarter, so every
    // covered cell already satisfied it. The first user report to land anywhere
    // would have been announced as reaching a square that "had no record at all",
    // of a square with records since 2011.
    await inRollback(async (tx) => {
      const taxonId = await plain();
      const before = await newThisSeason(tx);
      const [ex] = await tx`
        select st_x(location_public::geometry) as lng,
               st_y(location_public::geometry) as lat
          from reports_public where not is_obscured limit 1`;
      await insertReport(tx, { lng: ex.lng, lat: ex.lat, taxonId });
      assert.equal(
        await newThisSeason(tx),
        before,
        "a square recorded since 2011 is not newly reached",
      );
    });
  });

  test("a report on an empty square is newly reached", async () => {
    await inRollback(async (tx) => {
      const taxonId = await plain();
      const before = await newThisSeason(tx);
      await insertReport(tx, { lng: 119.2, lat: 24.1, taxonId });
      assert.equal(await newThisSeason(tx), before + 1);
    });
  });

  test("a report in a Taipei quarter's first hours counts, whatever zone the database keeps", async () => {
    // The quarter starts at midnight in Taipei, 16:00 UTC the day before. The
    // start used to be a wall-clock time compared as if it were in the
    // session's zone, UTC in production and in CI: eight hours late, so a
    // report made in those hours counted in no season at all. CI caught it by
    // running at 00:02 Taipei time on 1 October 2026.
    await inRollback(async (tx) => {
      await tx`set local time zone 'UTC'`;
      const taxonId = await plain();
      const before = await newThisSeason(tx);
      const r = await insertReport(tx, { lng: 119.2, lat: 24.1, taxonId });
      await tx`
        update reports
           set created_at = ${tx.unsafe(TAIPEI_QUARTER_START)} + interval '1 hour'
         where id = ${r.id}`;
      assert.equal(await newThisSeason(tx), before + 1);
    });
  });

  test("and one from the hour before the quarter does not", async () => {
    await inRollback(async (tx) => {
      await tx`set local time zone 'UTC'`;
      const taxonId = await plain();
      const before = await newThisSeason(tx);
      const r = await insertReport(tx, { lng: 119.2, lat: 24.1, taxonId });
      await tx`
        update reports
           set created_at = ${tx.unsafe(TAIPEI_QUARTER_START)} - interval '1 hour'
         where id = ${r.id}`;
      assert.equal(await newThisSeason(tx), before);
    });
  });

  test("the shipped query starts the season at the same instant", () => {
    const shipped = readFileSync(join(import.meta.dirname, "..", "lib", "coverage.ts"), "utf8").replace(/\s+/g, " ");
    assert.ok(shipped.includes(`select ${SEASON_START} as season_start`), "lib/coverage.ts computes the season's start differently");
    // And shows its dates in Taipei's calendar, not the session's.
    assert.match(shipped, /\(\(select season_start from bounds\) at time zone 'Asia\/Taipei'\)::text as "seasonStart"/);
  });

  test("the season page states the figure and the exclusion", async () => {
    // The page is rendered on demand, so its figure is the count at that
    // moment, and other test files file and remove reports while this one
    // runs: a count taken a moment later can be a square off. Main's run
    // failed on that on 5 October 2026, with nothing wrong on the page. So
    // the page and the count are read together, and read again, until one
    // reading finds them agreeing; a page that states some other number
    // never does.
    let shown = "";
    let n = -1;
    let agreed = false;
    for (let attempt = 0; attempt < 8 && !agreed; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 300));
      const res = await fetch(`${BASE_URL}/en/season`);
      assert.equal(res.status, 200);
      // What the page shows: its markup without the scripts, whose chunk
      // names and message catalogue could hold any digits by chance.
      shown = (await res.text()).replace(/<script\b[\s\S]*?<\/script>/g, "");
      // The number the page leads with has to be the one this file describes.
      n = await covered(sql);
      agreed = new RegExp(`(?<![\\d,])${n.toLocaleString("en-US")}(?![\\d,])`).test(shown);
    }
    assert.ok(agreed, `expected the covered-square count (${n}) on the page`);
    assert.match(
      shown,
      /left out of the squares above/,
      "the page must say that obscured records are excluded",
    );
  });
});
