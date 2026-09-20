/**
 * The arithmetic behind every pager.
 *
 * Worth its own file because paging fails quietly and at the edges: an
 * off-by-one in the offset shows the same row on two pages, or skips one, and
 * the page still renders eighty plausible species. Nobody notices until someone
 * reaches a boundary and looks carefully, which on a directory of 442 species
 * is nobody.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pageWindow } from "../lib/paging.ts";

describe("pageWindow", () => {
  test("the first page starts at the first row", () => {
    const w = pageWindow(1, 442, 80);
    assert.deepEqual(
      { page: w.page, offset: w.offset, from: w.from, to: w.to },
      { page: 1, offset: 0, from: 1, to: 80 },
    );
    assert.equal(w.hasPrev, false);
    assert.equal(w.hasNext, true);
  });

  test("pages tile the result set with no gap and no overlap", () => {
    // The property that matters, stated as one: walking every page must visit
    // every row exactly once.
    for (const [total, per] of [
      [442, 80],
      [80, 80],
      [81, 80],
      [1, 80],
      [161, 40],
      [7, 3],
    ]) {
      const visited = [];
      const { totalPages } = pageWindow(1, total, per);
      for (let p = 1; p <= totalPages; p++) {
        const w = pageWindow(p, total, per);
        for (let i = w.offset; i < Math.min(w.offset + per, total); i++)
          visited.push(i);
      }
      assert.deepEqual(
        visited,
        [...Array(total).keys()],
        `pages do not tile ${total} rows ${per} at a time`,
      );
    }
  });

  test("the last page is short rather than overrunning the total", () => {
    const w = pageWindow(6, 442, 80);
    assert.deepEqual([w.from, w.to], [401, 442]);
    assert.equal(w.hasNext, false);
    assert.equal(w.totalPages, 6);
  });

  test("an out-of-range page is clamped, never refused", () => {
    // A directory route sits under a loading.tsx, and redirect() or notFound()
    // beneath one answers 200 with the skeleton. So ?page=99 has to render the
    // last page rather than bounce, and a stale bookmark still shows something.
    assert.equal(pageWindow(99, 442, 80).page, 6);
    assert.equal(pageWindow(0, 442, 80).page, 1);
    assert.equal(pageWindow(-4, 442, 80).page, 1);
  });

  test("nonsense is page one", () => {
    for (const bad of ["abc", "", undefined, null, NaN, "1.5e"])
      assert.equal(pageWindow(bad, 442, 80).page, 1, `?page=${bad}`);
    // A decimal is floored rather than rejected: ?page=2.7 means page 2.
    assert.equal(pageWindow("2.7", 442, 80).page, 2);
  });

  test("an empty result set still has a page to be on", () => {
    const w = pageWindow(3, 0, 80);
    assert.equal(w.totalPages, 1);
    assert.equal(w.page, 1);
    // No rows, so no range to print: 1–0 of 0 would be worse than nothing.
    assert.deepEqual([w.from, w.to], [0, 0]);
    assert.equal(w.hasPrev, false);
    assert.equal(w.hasNext, false);
  });

  test("a single full page offers no next", () => {
    const w = pageWindow(1, 80, 80);
    assert.equal(w.totalPages, 1);
    assert.equal(w.hasNext, false);
    assert.deepEqual([w.from, w.to], [1, 80]);
  });
});
