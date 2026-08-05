/**
 * The binned density map, and the guard against the blur coming back.
 *
 * History worth keeping, because it was expensive: the map used a MapLibre
 * `heatmap` layer, which is a kernel density estimate — every feature is splatted
 * as a Gaussian and the splats are summed. Blur is the *definition* of that
 * layer, not a setting, so two rounds of tuning `heatmap-radius` and
 * `heatmap-weight` could never have fixed it. Replacing the layer with discrete
 * filled cells did, in one change.
 *
 * The first test below is therefore the important one: it fails if anyone
 * reintroduces a heatmap layer. The rest pin the things a crisp binned map
 * actually depends on.
 *
 * None of this can check that the map *looks* good — nothing automated can.
 * `npm run test:map` drives real headless Chromium and writes a screenshot; the
 * sandbox suspends requestAnimationFrame, so MapLibre paints nothing there and a
 * broken map is indistinguishable from a working one.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGGREGATION_CELLS_PER_TILE,
  aggregationCellMeters,
  DENSITY_CLASSES,
  SPECIES_DENSITY_CLASSES,
  densityClassMax,
  densityStepExpression,
} from "@conservation/shared";

const WEB = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(WEB, p), "utf8");

const MAP_COMPONENTS = [
  "components/map/HeatmapView.tsx",
  "components/species/SpeciesMap.tsx",
];

describe("the blur stays gone", () => {
  for (const path of MAP_COMPONENTS) {
    test(`${path} uses no heatmap layer`, () => {
      const src = read(path);
      for (const banned of ['type: "heatmap"', '"heatmap-radius"', '"heatmap-weight"', '"heatmap-intensity"']) {
        assert.ok(
          !src.includes(banned),
          `${path} contains ${banned}. MapLibre's heatmap layer is a kernel ` +
            `density estimate, so it is blurry by construction — tuning its radius ` +
            `and weight cannot make it sharp, which is why this map draws discrete ` +
            `cells instead. If you genuinely want a heatmap back, delete this test ` +
            `deliberately rather than by accident.`,
        );
      }
    });

    test(`${path} draws cells as a fill`, () => {
      assert.ok(read(path).includes('type: "fill"'), `${path} should render cells as filled polygons`);
    });

    test(`${path} disables fill antialiasing`, () => {
      // Neighbouring cells share an exact edge. Antialiasing them draws a faint
      // hairline between every pair, which reads as a grid over the whole map.
      assert.ok(
        read(path).includes('"fill-antialias": false'),
        `${path} must set fill-antialias:false or shared cell edges show hairlines`,
      );
    });
  }
});

describe("the bins/dots toggle", () => {
  const src = read("components/map/HeatmapView.tsx");

  test("a dots layer exists alongside the cells layer", () => {
    assert.ok(src.includes('"source-layer": DOT_SOURCE_LAYER'), "dots must read the tile's second layer");
    assert.ok(src.includes('type: "circle"'), "dots are a circle layer");
  });

  test("dot radius keeps the zoom expression outermost", () => {
    // MapLibre rejects a paint property that depends on both zoom and feature
    // data unless the zoom interpolate is the OUTERMOST expression. Getting this
    // wrong is uniquely nasty: validation fails at addLayer time, the layer is
    // never added, the map renders fine without it, and nothing throws. A
    // `["*", zoomExpr, dataExpr]` radius blanked the dots across five zoom levels
    // and every existing test still passed.
    const i = src.indexOf("const dotRadius");
    const decl = src.slice(i, src.indexOf("] as unknown", i));
    const firstToken = decl.slice(decl.indexOf("["));
    assert.match(
      firstToken.replace(/\/\/[^\n]*\n/g, "").trimStart(),
      /^\[\s*"interpolate"/,
      'dotRadius must begin with a top-level "interpolate"; nesting ["zoom"] inside another operator makes MapLibre drop the layer silently',
    );
    assert.ok(
      decl.includes('["zoom"]'),
      "the outer interpolate should be the zoom one",
    );
  });

  test("dot radius scales with the square root of the count", () => {
    // Interpolating on the raw count scales the *radius*, which squares the
    // visual weight and wildly overstates dense cells — the classic
    // proportional-symbol error. Area must scale with the count, so the input
    // has to be sqrt.
    const i = src.indexOf("const dotRadius");
    assert.ok(i > -1, "expected a dotRadius expression");
    const decl = src.slice(i, src.indexOf("];", i));
    assert.ok(decl.includes('"sqrt"'), "dot radius must interpolate on sqrt(weight), not the raw count");
  });

  test("the choice persists via useSyncExternalStore, not useState", () => {
    assert.ok(src.includes("localStorage"), "the mode should survive a reload");
    // Two simpler approaches are both wrong, and both were tried:
    //   - localStorage in a useState initialiser runs during hydration too, where
    //     the server could not have known the value -> hydration mismatch.
    //   - restoring it via setState in an effect body -> cascading renders, which
    //     the react-hooks lint rule rejects.
    assert.ok(
      src.includes("useSyncExternalStore"),
      "read the persisted mode through useSyncExternalStore",
    );
    assert.ok(
      !src.includes("useState<MapMode>"),
      "the mode is external state; useState reintroduces the hydration mismatch",
    );
  });
});

describe("the zoom handoff has no blank band", () => {
  const src = read("components/map/HeatmapView.tsx");

  /**
   * Source of one addLayer block, so a lookup cannot wander into another layer.
   * The dots layer sets a constant `circle-opacity` before the point layer sets a
   * ramp, so an unscoped indexOf finds the wrong one and then parses whatever
   * array happens to come next.
   */
  function layerBlock(idConst) {
    const at = src.indexOf(`id: ${idConst},`);
    if (at === -1) return "";
    const end = src.indexOf("map.addLayer({", at + 1);
    return src.slice(at, end === -1 ? src.length : end);
  }

  /** Pull an ["interpolate", ["linear"], ["zoom"], z, v, …] ramp out of a block. */
  function zoomRamp(src, key) {
    const at = src.indexOf(`"${key}":`);
    if (at === -1) return null;
    if (src[src.indexOf(":", at) + 1] !== " " || src.slice(at).match(/^"[^"]+":\s*\[/) === null) return null;
    const open = src.indexOf("[", at);
    let depth = 0, end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "[") depth++;
      else if (src[i] === "]" && --depth === 0) { end = i; break; }
    }
    if (end === -1) return null;
    const nums = src.slice(open, end).match(/(?<![\w.])-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    return { zooms: nums.filter((_, i) => i % 2 === 0), values: nums.filter((_, i) => i % 2 === 1) };
  }

  test("the point layer is not transparent at the zoom it takes over", () => {
    // The bug this pins: cells stop dead at TILE_AGGREGATION_MAX_ZOOM because the
    // tiles stop carrying them, while the point layer's opacity ramp started at 0
    // and only reached full several zoom levels later. Everything between was
    // drawn and invisible — zooming in made the map go blank and "come back" much
    // later. Nothing caught it: the features were all present, just at alpha 0.
    const block = layerBlock("POINT_LAYER");
    assert.ok(block, "could not locate the point layer");
    const ramp = zoomRamp(block, "circle-opacity");
    assert.ok(ramp, "expected a circle-opacity ramp on the point layer");
    const firstValue = ramp.values[0];
    assert.ok(
      firstValue >= 0.5,
      `the point layer starts at opacity ${firstValue}; it must be visible as soon ` +
        `as it takes over, because nothing else is drawn past the handoff`,
    );
  });

  test("the point layer starts exactly where aggregation stops", () => {
    assert.ok(
      src.includes("minzoom: TILE_AGGREGATION_MAX_ZOOM + 1"),
      "derive the point layer's minzoom from TILE_AGGREGATION_MAX_ZOOM so the two cannot drift",
    );
  });

  test("the aggregate source is capped so its last tile overzooms", () => {
    // This is what removes the blank frame at the handoff. Capping the aggregate
    // source at TILE_AGGREGATION_MAX_ZOOM makes MapLibre scale up the last
    // aggregated tile rather than request one the endpoint does not serve, so the
    // cells stay painted while the first point tiles are still loading. With a
    // single uncapped source, crossing the boundary produced a frame with 0% of
    // the view painted — measured on a continuous wheel zoom.
    // Scoped to the addSource call. An unscoped substring check passes on the
    // cell layer's `maxzoom: TILE_AGGREGATION_MAX_ZOOM + 2`, which contains it.
    const aggAt = src.indexOf("map.addSource(SOURCE_AGG");
    assert.ok(aggAt > -1, "expected an aggregate source");
    const aggBlock = src.slice(aggAt, src.indexOf("});", aggAt));
    assert.match(
      aggBlock,
      /maxzoom:\s*TILE_AGGREGATION_MAX_ZOOM\s*,/,
      "the aggregate source must stop exactly at TILE_AGGREGATION_MAX_ZOOM so its last tile overzooms",
    );

    const ptsAt = src.indexOf("map.addSource(SOURCE_PTS");
    assert.ok(ptsAt > -1, "expected a separate point source");
    const ptsBlock = src.slice(ptsAt, src.indexOf("});", ptsAt));
    assert.match(
      ptsBlock,
      /minzoom:\s*TILE_AGGREGATION_MAX_ZOOM \+ 1/,
      "the point source should not fetch tiles the aggregate regime already serves",
    );
  });

  test("cells outlive the handoff, fading, to cover tile load time", () => {
    // They must NOT stop dead at the boundary: that is precisely what left a gap
    // while the point tiles loaded.
    assert.ok(
      src.includes("maxzoom: TILE_AGGREGATION_MAX_ZOOM + 2"),
      "cell and dot layers should outlast the handoff so they can fade over it",
    );
    const at = src.indexOf('"fill-opacity"');
    assert.ok(at > -1);
    const decl = src.slice(at, at + 400);
    assert.ok(decl.includes("interpolate"), "fill-opacity should fade across the handoff");
  });
});

describe("aggregation grid", () => {
  test("is pinned, so a change forces the map to be re-checked", () => {
    assert.equal(
      AGGREGATION_CELLS_PER_TILE,
      128,
      [
        "The aggregation grid changed. Nothing below is automatic — go and look:",
        "  1. MapLibre renders vector tiles at 512 CSS px, so this constant sets",
        "     the on-screen cell size directly: 512 / value, at every zoom.",
        "  2. Re-check DENSITY_CLASSES — bigger cells hold more reports, so the",
        "     breaks and the legend they generate may no longer fit the data.",
        "  3. Same for SPECIES_DENSITY_CLASSES on the species pages.",
        "  4. Check the z6 tile size stayed reasonable (~39 KB at 128 cells).",
        "  5. Run `npm run test:map` and actually look at the screenshot.",
        "Then update this expected value and the README's tile section.",
      ].join("\n"),
    );
  });

  test("cells are large enough on screen to read as shapes", () => {
    const px = 512 / AGGREGATION_CELLS_PER_TILE;
    // Below ~3px a cell is indistinguishable from noise — measured by comparing
    // 256 cells/tile (2px, speckled) against 128 (4px, legible).
    assert.ok(px >= 3, `cells render at ${px}px; below 3px they read as noise, not bins`);
    assert.ok(px <= 16, `cells render at ${px}px; that is coarse enough to hide real structure`);
  });

  test("cell size halves with each zoom level", () => {
    for (let z = 3; z < 9; z++) {
      const ratio = aggregationCellMeters(z) / aggregationCellMeters(z + 1);
      assert.ok(Math.abs(ratio - 2) < 1e-9, `z${z}->z${z + 1} ratio was ${ratio}`);
    }
  });
});

describe("density classes", () => {
  for (const [name, classes] of [
    ["DENSITY_CLASSES", DENSITY_CLASSES],
    ["SPECIES_DENSITY_CLASSES", SPECIES_DENSITY_CLASSES],
  ]) {
    test(`${name} breaks strictly increase`, () => {
      // A `step` expression with non-increasing stops is rejected by MapLibre at
      // style-load time and takes the whole layer with it.
      for (let i = 1; i < classes.length; i++) {
        assert.ok(
          classes[i].min > classes[i - 1].min,
          `${name}[${i}].min (${classes[i].min}) must exceed [${i - 1}].min (${classes[i - 1].min})`,
        );
      }
    });

    test(`${name} starts at 1, since a cell only exists if it holds a report`, () => {
      assert.equal(classes[0].min, 1);
    });

    test(`${name} colours are valid hex`, () => {
      for (const c of classes) {
        assert.match(c.color, /^#[0-9a-f]{6}$/i, `${name}: ${c.color} is not a hex colour`);
      }
    });

    test(`${name} produces a well-formed step expression`, () => {
      const expr = densityStepExpression(classes);
      assert.equal(expr[0], "step");
      // ["step", input, out0, in1, out1, …] — one output, then a pair per break.
      assert.equal(expr.length, 3 + (classes.length - 1) * 2);
      for (let i = 3; i < expr.length; i += 2) {
        assert.equal(typeof expr[i], "number", "break inputs must be numbers");
        assert.equal(typeof expr[i + 1], "string", "break outputs must be colours");
      }
    });
  }

  test("the all-records map dims its lowest class", () => {
    // Most cells in the country hold one or two reports. A bright colour there
    // turns the map into noise and buries the road corridors — dimming this one
    // class is what made the structure legible.
    const hex = DENSITY_CLASSES[0].color;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    assert.ok(
      luminance < 0.25,
      `lowest class ${hex} has luminance ${luminance.toFixed(2)}; it must recede, not shout`,
    );
    const brighter = DENSITY_CLASSES[1].color;
    const [r2, g2, b2] = [1, 3, 5].map((i) => parseInt(brighter.slice(i, i + 2), 16));
    assert.ok(
      (0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2) / 255 > luminance,
      "the second class must be brighter than the first",
    );
  });

  test("species breaks are compressed relative to the all-records breaks", () => {
    // Even the most-reported species holds a few thousand records against the
    // corpus's 46k. Reusing the main breaks would push nearly every cell into the
    // lowest, deliberately-dim class and the species map would look empty.
    assert.ok(
      SPECIES_DENSITY_CLASSES.at(-1).min < DENSITY_CLASSES.at(-1).min,
      "the species scale must top out lower than the all-records scale",
    );
  });

  test("class ranges are contiguous, with no gap or overlap", () => {
    for (let i = 0; i < DENSITY_CLASSES.length - 1; i++) {
      assert.equal(
        densityClassMax(i),
        DENSITY_CLASSES[i + 1].min - 1,
        `class ${i} must end exactly where class ${i + 1} begins`,
      );
    }
    assert.equal(densityClassMax(DENSITY_CLASSES.length - 1), null, "top class is open-ended");
  });
});
