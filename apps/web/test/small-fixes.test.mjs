/**
 * A batch of small things a reader would notice, each held where it is decided.
 *
 *   node --test test/small-fixes.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");

describe("fields a phone does not zoom into", () => {
  // iOS Safari zooms the page into a focused field set under 16px.
  const classesOf = (src, marker) => {
    const at = src.indexOf(marker);
    assert.ok(at >= 0, `${marker} not found`);
    return /className="([^"]+)"/.exec(src.slice(at))?.[1] ?? "";
  };

  test("the map's species filter and year selects", () => {
    const src = read("components", "map", "MapFilters.tsx");
    const input = classesOf(src, 'aria-label={t("map.filterSpecies")}');
    assert.match(input, /(^| )text-base( |$)/);
    assert.match(input, /(^| )sm:text-xs( |$)/);
    for (const label of ['aria-label={t("map.fromYear")}', 'aria-label={t("map.toYear")}']) {
      const select = classesOf(src, label);
      assert.match(select, /(^| )text-base( |$)/, label);
    }
  });

  test("the species directory's search box", () => {
    const src = read("components", "species", "SpeciesSearch.tsx");
    const input = classesOf(src, 'type="search"');
    assert.match(input, /(^| )text-base( |$)/);
  });
});
