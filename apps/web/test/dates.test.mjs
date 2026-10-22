/**
 * Days are Taiwan's days.
 *
 * The map's record panel printed the first ten characters of a timestamp,
 * which is the day in UTC: a report of an animal found at 06:30 on 1 October
 * in Taipei said 30 September. lib/dates.ts is the one formatter.
 *
 *   node --test test/dates.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatTaipeiDate } from "../lib/dates.ts";

const read = (...p) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
// Half past six in the morning, 1 October, in Taipei.
const DAWN = "2026-09-30T22:30:00Z";

describe("formatTaipeiDate", () => {
  test("a dawn report in Taipei is on 1 October, not the UTC day before", () => {
    assert.equal(formatTaipeiDate(DAWN, "en", { dateStyle: "medium" }), "Oct 1, 2026");
    assert.equal(formatTaipeiDate(DAWN, "zh-TW", { dateStyle: "medium" }), "2026年10月1日");
    assert.equal(formatTaipeiDate(new Date(DAWN), "zh-TW"), "2026/10/1");
  });

  test("whatever the machine's own zone, and whatever zone is asked for", () => {
    // The server runs in UTC and a reader's phone in anything; neither moves
    // the day. A caller's timeZone cannot either.
    assert.equal(formatTaipeiDate(DAWN, "en", { timeZone: "UTC" }), "10/1/2026");
  });

  test("an imported record, stored as midnight UTC, keeps its own day", () => {
    assert.equal(formatTaipeiDate("2017-12-31T00:00:00Z", "zh-TW"), "2017/12/31");
  });
});

describe("the pages ask it", () => {
  test("the map's record panel no longer cuts the timestamp", () => {
    const panel = read("components", "map", "ReportPanel.tsx");
    assert.doesNotMatch(panel, /observedAt\.slice\(0,\s*10\)/);
    assert.match(panel, /formatTaipeiDate\(report\.observedAt/);
  });
});
