/**
 * The basemap's label rewrite, run against a saved copy of the real style.
 *
 * Every rule here breaks silently. A label layer that reads name:zh-Hans renders
 * perfectly well; it just shows 台北市 to a Taiwanese audience. A layer matched by
 * id stops being matched the day upstream renames it, and the map simply goes
 * back to "TAIPEI". So these assert on the transformed style itself.
 *
 * test/fixtures/openfreemap-dark.json is https://tiles.openfreemap.org/styles/dark
 * as served on 2026-09-11. Refresh it if OpenFreeMap restyles, and re-run.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
  transformBasemap,
  NAME_ZH,
  NAME_EN,
  FALLBACK_STYLE,
} from "../lib/basemap.ts";

const style = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "fixtures", "openfreemap-dark.json"),
    "utf8",
  ),
);

const readsName = (l) =>
  l.type === "symbol" &&
  /name/.test(JSON.stringify(l.layout?.["text-field"] ?? null));
const named = (s) => s.layers.filter(readsName);
const byId = (s, id) => s.layers.find((l) => l.id === id);

describe("basemap label rewrite", () => {
  test("the fixture has the problem this exists to fix", () => {
    // If upstream stops printing Latin-over-local, these tests would pass
    // vacuously. Fail loudly instead, so the fixture gets looked at.
    assert.ok(
      named(style).length >= 10,
      "expected the stock name label layers",
    );
    assert.ok(
      JSON.stringify(style.layers).includes("name:latin"),
      "stock style should still read name:latin",
    );
  });

  test("Chinese pages read Traditional first, and never Simplified", () => {
    const out = transformBasemap(style, "zh-TW");
    assert.equal(named(out).length, named(style).length);
    for (const l of named(out)) {
      assert.deepEqual(l.layout["text-field"], NAME_ZH, l.id);
      assert.ok(!("text-transform" in l.layout), `${l.id} still uppercases`);
    }
    const all = JSON.stringify(out.layers);
    assert.ok(
      !all.includes("name:zh-Hans"),
      "name:zh-Hans holds Simplified forms",
    );
    assert.ok(!all.includes("name:latin"), "no Latin-over-local labels left");
    assert.ok(!all.includes("name:nonlatin"));
  });

  test("English pages read English", () => {
    const out = transformBasemap(style, "en");
    for (const l of named(out))
      assert.deepEqual(l.layout["text-field"], NAME_EN, l.id);
  });

  test("road numbers are left alone", () => {
    const out = transformBasemap(style, "zh-TW");
    assert.deepEqual(
      byId(out, "highway_name_motorway"),
      byId(style, "highway_name_motorway"),
    );
  });

  test("every layer that is not a name label or a boundary is untouched", () => {
    const out = transformBasemap(style, "zh-TW");
    for (const l of style.layers) {
      if (!readsName(l) && l["source-layer"] !== "boundary") {
        assert.deepEqual(byId(out, l.id), l, l.id);
      }
    }
  });

  test("sea boundaries are filtered out, land boundaries kept", () => {
    const out = transformBasemap(style, "zh-TW");
    const boundaries = out.layers.filter(
      (l) => l["source-layer"] === "boundary",
    );
    assert.ok(boundaries.length > 0, "the fixture should have boundary layers");
    for (const l of boundaries) {
      const f = JSON.stringify(l.filter);
      assert.ok(f.includes('"maritime"'), `${l.id} still draws sea boundaries`);
      // The original admin-level condition must survive inside the new one.
      assert.ok(f.includes("admin_level"), `${l.id} lost its own filter`);
    }
  });

  test("labels are brightened, and roads stay dimmer than places", () => {
    const out = transformBasemap(style, "zh-TW");
    assert.equal(byId(out, "place_city").paint["text-color"], "#9a9a9a");
    assert.equal(
      byId(out, "highway_name_other").paint["text-color"],
      "#7a7a7a",
    );
  });

  test("the input style is not mutated", () => {
    const before = structuredClone(style);
    transformBasemap(style, "zh-TW");
    transformBasemap(style, "en");
    assert.deepEqual(style, before);
  });

  test("the result is a valid MapLibre style, in both languages", () => {
    for (const locale of ["zh-TW", "en"]) {
      assert.deepEqual(
        validateStyleMin(transformBasemap(style, locale)),
        [],
        locale,
      );
    }
  });

  test("the fallback is valid and depends on nothing remote", () => {
    // It exists for when the basemap host is down, so it must not need it.
    assert.deepEqual(validateStyleMin(FALLBACK_STYLE), []);
    assert.equal(Object.keys(FALLBACK_STYLE.sources).length, 0);
    assert.equal(FALLBACK_STYLE.glyphs, undefined);
    assert.equal(FALLBACK_STYLE.sprite, undefined);
  });
});
