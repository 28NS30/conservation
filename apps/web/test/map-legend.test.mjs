/**
 * The legend's truth table.
 *
 * The map overrides the reader's colour choice in two places and used to say
 * nothing about either: above the aggregation handoff it draws one circle per
 * record, coloured by category whatever the switch says, and the heat surface's
 * ramp is fixed. Both produced a legend that named quantities nothing on screen
 * had — a single roadkill dot labelled "300+", per-cell counts beside a kernel
 * density estimate.
 *
 * So the rule lives in one pure function and is pinned here, rather than being
 * re-derived inside JSX where it can only be checked by looking at the screen.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TILE_AGGREGATION_MAX_ZOOM } from "@conservation/shared";
import {
  legendFor,
  POINTS_FROM_ZOOM,
  HEAT_STOPS,
  heatColorExpression,
  heatGradientCss,
} from "../components/map/legend.ts";

const MODES = ["heat", "bins", "dots"];
const COLOURS = ["density", "type"];

/** Every mode × colour pair, which is the whole space the two switches offer. */
const pairs = MODES.flatMap((mode) => COLOURS.map((colour) => ({ mode, colour })));

describe("which legend belongs to a view", () => {
  test("the handoff zoom is derived, not written down", () => {
    // A literal 14 here and a `TILE_AGGREGATION_MAX_ZOOM + 1` in the point
    // layer's minzoom would agree today and drift the day the constant moves,
    // and the drift is invisible: the legend simply describes the other regime.
    assert.equal(POINTS_FROM_ZOOM, TILE_AGGREGATION_MAX_ZOOM + 1);
  });

  test("just below the handoff, mode and colour decide", () => {
    const zoom = POINTS_FROM_ZOOM - 0.01;
    const got = pairs.map(({ mode, colour }) => [
      `${mode}/${colour}`,
      legendFor({ mode, colour, zoom }).kind,
    ]);
    assert.deepEqual(Object.fromEntries(got), {
      "heat/density": "heat",
      "heat/type": "heat",
      "bins/density": "density",
      "bins/type": "type",
      "dots/density": "density",
      "dots/type": "type",
    });
  });

  test("at the handoff every pair becomes the record legend", () => {
    for (const { mode, colour } of pairs) {
      const l = legendFor({ mode, colour, zoom: POINTS_FROM_ZOOM });
      assert.equal(l.kind, "points", `${mode}/${colour}`);
      // This is the "300+" bug: the density classes must not be reachable here,
      // whatever the reader last chose.
      assert.equal(l.colour, "type", `${mode}/${colour}`);
    }
  });

  test("a locked switch reports the colour actually in use, and why", () => {
    const heat = legendFor({ mode: "heat", colour: "type", zoom: 8 });
    assert.equal(heat.locked, true);
    assert.equal(heat.colour, "density");
    assert.equal(heat.reason, "map.colourLockedHeat");

    const points = legendFor({ mode: "bins", colour: "density", zoom: 15 });
    assert.equal(points.locked, true);
    assert.equal(points.colour, "type");
    assert.equal(points.reason, "map.colourLockedPoints");
  });

  test("where both options apply, neither is locked", () => {
    for (const colour of COLOURS)
      for (const mode of ["bins", "dots"]) {
        const l = legendFor({ mode, colour, zoom: 8 });
        assert.equal(l.locked, false, `${mode}/${colour}`);
        assert.equal(l.reason, null, `${mode}/${colour}`);
        // The stored choice is what is drawn, so the legend follows it.
        assert.equal(l.colour, colour, `${mode}/${colour}`);
      }
  });

  test("zoom outranks mode, and mode outranks colour", () => {
    // The order matters because the map overrides in that order: no mode draws
    // cells above the handoff, and no colour setting reaches the heat ramp.
    assert.equal(
      legendFor({ mode: "heat", colour: "type", zoom: POINTS_FROM_ZOOM }).kind,
      "points",
    );
    assert.equal(
      legendFor({ mode: "heat", colour: "type", zoom: 0 }).kind,
      "heat",
    );
  });
});

describe("the heat ramp is one array", () => {
  test("the paint expression is exactly what the layer used to carry inline", () => {
    // Pinned against the literal that was in HeatmapView's HEAT_LAYER paint, so
    // lifting it into a constant cannot have changed a single stop.
    assert.deepEqual(heatColorExpression(), [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0,
      "rgba(0,0,0,0)",
      0.15,
      "rgba(56,132,255,0.55)",
      0.35,
      "rgba(34,211,238,0.7)",
      0.55,
      "rgba(52,211,153,0.8)",
      0.75,
      "rgba(251,146,60,0.88)",
      1,
      "rgba(244,63,94,0.95)",
    ]);
  });

  test("the stops rise from nothing to full density", () => {
    assert.equal(HEAT_STOPS[0][0], 0);
    assert.equal(HEAT_STOPS.at(-1)[0], 1);
    for (let i = 1; i < HEAT_STOPS.length; i++)
      assert.ok(
        HEAT_STOPS[i][0] > HEAT_STOPS[i - 1][0],
        `stop ${i} does not rise`,
      );
  });

  test("the legend bar is drawn from the same stops as the paint", () => {
    const css = heatGradientCss();
    assert.match(css, /^linear-gradient\(to right, /);
    for (const [at, color] of HEAT_STOPS)
      assert.ok(
        css.includes(`${color} ${Math.round(at * 100)}%`),
        `the bar omits the stop ${color} at ${at}`,
      );
  });
});
