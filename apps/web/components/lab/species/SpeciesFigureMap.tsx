"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ExpressionSpecification, Map as MLMap } from "maplibre-gl";
import {
  TAIWAN_MAIN_BOUNDS,
  TILE_AGGREGATION_MAX_ZOOM,
  TILE_SOURCE_BOUNDS,
} from "@conservation/shared";
import { createMap, type MapHandle } from "@/lib/map";
import { withBase } from "@/lib/basePath";
import { speciesDensitySteps } from "@/lib/lab/species";

const SOURCE_AGG = "lab-species-agg";
const SOURCE_PTS = "lab-species-pts";
const CELL_SOURCE_LAYER = "reports";
const CELL_LAYER = "lab-species-cells";
const POINT_LAYER = "lab-species-points";

/**
 * One taxon's records, in a portrait frame, painted in the direction's own colours.
 *
 * WHY PORTRAIT. Taiwan is 2.3 degrees wide and 3.7 tall. The live species panel
 * is a short wide box, so the island occupies a thin strip down its middle and
 * the rest is ocean; a 4:5 frame gives the island the space and the page a
 * column. See `.lab-map-portrait`.
 *
 * WHY IT COSTS NOTHING NEW. It goes through `createMap`, exactly as
 * `HeatmapView` and `SpeciesMap` do, so it inherits the raw-ESM MapLibre load
 * (the bundled worker is silently broken — see `lib/map.ts`), the
 * `FALLBACK_STYLE` degradation, the missing-image resolver and the
 * ResizeObserver. The tiles are the existing public `/api/tiles` endpoint with
 * a `taxonId`, so location blurring is inherited rather than reimplemented: a
 * sensitive taxon is blurred here for the same reason it is blurred everywhere.
 * No new endpoint, no new request type, no font.
 *
 * WHY THE COLOURS ARE READ FROM CSS. A direction is a theme file, so this
 * component may not know a hex. It reads the `--map-*` and `--ramp-*` custom
 * properties off its own container — which sits inside `[data-direction]` — and
 * hands them to MapLibre. Swapping the theme repaints the basemap with it, and
 * nothing here needs touching.
 */
export default function SpeciesFigureMap({
  taxonId,
  /** Announced to a screen reader; the figure's finding sentence does the rest. */
  label,
  unavailableText,
}: {
  taxonId: number;
  label: string;
  unavailableText: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MapHandle | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!container.current || handleRef.current) return;
    const element = container.current;
    let cancelled = false;

    void (async () => {
      const scheme = readScheme(element);
      const ramp = readRamp(element);

      let handle: MapHandle;
      try {
        handle = await createMap(element, {
          // maxBounds fights fitBounds whenever the container is not the shape
          // of the bounds, and silently overrides the framing — the same clamp
          // that broke the hero and the live species panel.
          bounded: false,
          navigation: true,
          // The tile endpoint serves aggregated cells to z13 and raw points
          // above it; both are wired below, so the figure stays honest all the
          // way in rather than going blank past the handoff.
          maxZoom: 16,
          onReady: (map) => {
            repaint(map, scheme);
            addLayers(map, taxonId, ramp);
          },
        });
      } catch (err) {
        // A figure that cannot draw says so and collapses to its numbers; it
        // never leaves an empty box that reads as a rendering fault.
        console.warn("[lab] species map unavailable", err);
        if (!cancelled) setFailed(true);
        return;
      }

      if (cancelled) return handle.destroy();
      handleRef.current = handle;

      /*
       * Cooperative gestures: a wheel needs ctrl/cmd and a touch needs two
       * fingers before the map takes the gesture. This is a picture inside a
       * scrolling article, and a map that eats the page scroll the moment a
       * thumb crosses it is the single most irritating thing an embedded map
       * does. Enabled after construction because `createMap` is a live file and
       * does not take the option; `enable()` builds its own overlay and reads
       * nothing from the constructor.
       */
      handle.map.cooperativeGestures.enable();

      /*
       * Weighted east. Everything west of the island is Fujian, and the frame
       * is wider than the island is at this aspect, so symmetric padding puts
       * mainland China in the corner of every species page. Padding the right
       * shifts the fitted island left until its west edge meets the frame's.
       */
      const fit = () =>
        handle.map.fitBounds(TAIWAN_MAIN_BOUNDS, {
          padding: {
            top: 16,
            bottom: 16,
            left: 0,
            right: Math.round(
              handle.map.getCanvas().getBoundingClientRect().width * 0.25,
            ),
          },
          // Always instant: this is the initial framing, not a transition, and
          // an animated one would also have to be suppressed under reduced
          // motion.
          duration: 0,
        });
      fit();
      handle.map.on("resize", fit);
    })();

    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [taxonId]);

  return (
    // `role="group"` rather than `img`: the frame holds MapLibre's own zoom
    // buttons, and `img` would hide them from a screen reader along with the
    // canvas. The label names what the frame is; the Figure's heading around it
    // says what it shows.
    <div className="lab-map-portrait bg-(--skeleton)" role="group" aria-label={label}>
      <div
        ref={container}
        // `relative h-full` is required, not tidiness: MapLibre 6 does not add
        // its own class to the element it is handed, so a static container lets
        // the absolutely-positioned canvas escape to the viewport.
        className="relative h-full w-full"
      />
      {failed ? (
        <p className="t-body absolute inset-0 flex items-center p-4 text-(--fg)">
          {unavailableText}
        </p>
      ) : null}
    </div>
  );
}

/* ---- the direction's colours, read from the direction's own CSS ---------- */

type Scheme = {
  water: string;
  land: string;
  road: string;
  label: string;
  halo: string;
};

function readScheme(element: HTMLElement): Scheme {
  const css = getComputedStyle(element);
  const read = (name: string) => css.getPropertyValue(name).trim();
  return {
    water: read("--map-water"),
    land: read("--map-land"),
    road: read("--map-road"),
    label: read("--map-label"),
    halo: read("--map-halo"),
  };
}

function readRamp(element: HTMLElement): string[] {
  const css = getComputedStyle(element);
  return [1, 2, 3, 4, 5, 6].map((n) =>
    css.getPropertyValue(`--ramp-${n}`).trim(),
  );
}

/**
 * The only OpenMapTiles source layers this has to name.
 *
 * Matching on layer ids would break the first time OpenFreeMap renames one, and
 * the failure would be a map with three landcover greens left in it — visible
 * only to somebody who knows what it should have looked like. Source-layer
 * names are part of the tile schema and do not move. Everything NOT water is
 * flattened into the land colour, which is the whole move: the island becomes
 * one solid block, and the only things left on it are the roads, the labels and
 * the data.
 */
const WATER_LAYERS = new Set(["water", "waterway", "ocean"]);

/**
 * Repaint the basemap to the badge: the island becomes the inside of the emblem.
 *
 * Run at `style.load`, before any basemap tile has drawn, so there is no flash
 * of the stock scheme. It only ever sets paint properties that the layer's own
 * type supports, because MapLibre logs an error per bad call and a map that
 * works but shouts in the console is a map nobody trusts.
 */
function repaint(map: MLMap, scheme: Scheme) {
  if (!scheme.land) return;
  for (const layer of map.getStyle().layers) {
    const source = (layer as { "source-layer"?: string })["source-layer"];
    // `setPaintProperty` is typed against the union of every layer type's paint
    // keys, and narrowing it per branch would be five overloads to say one
    // thing. Each call below is guarded by `layer.type`, which is the check the
    // type would have been doing.
    const set = (prop: string, value: string) => {
      if (value)
        map.setPaintProperty(
          layer.id,
          prop as Parameters<MLMap["setPaintProperty"]>[1],
          value,
        );
    };

    if (layer.type === "background") set("background-color", scheme.land);
    else if (layer.type === "fill")
      set(
        "fill-color",
        source && WATER_LAYERS.has(source) ? scheme.water : scheme.land,
      );
    else if (layer.type === "line")
      set(
        "line-color",
        source && WATER_LAYERS.has(source) ? scheme.water : scheme.road,
      );
    else if (layer.type === "fill-extrusion")
      set("fill-extrusion-color", scheme.land);
    else if (layer.type === "symbol") {
      set("text-color", scheme.label);
      set("text-halo-color", scheme.halo);
    }
  }
}

function addLayers(map: MLMap, taxonId: number, ramp: string[]) {
  if (map.getSource(SOURCE_AGG)) return;

  // Built by concatenation, not `new URL()`: the URL spec percent-encodes `{`
  // and `}`, which stops MapLibre substituting the tile placeholders.
  const tiles = `${window.location.origin}${withBase("/api/tiles")}/{z}/{x}/{y}?taxonId=${taxonId}`;

  map.addSource(SOURCE_AGG, {
    type: "vector",
    tiles: [tiles],
    // Never ask for a tile that cannot hold a report.
    bounds: TILE_SOURCE_BOUNDS,
    minzoom: 0,
    // Stops here: beyond this the endpoint serves points, so MapLibre should
    // overzoom the last aggregated tile rather than fetch one with no polygons.
    maxzoom: TILE_AGGREGATION_MAX_ZOOM,
  });
  map.addSource(SOURCE_PTS, {
    type: "vector",
    tiles: [tiles],
    bounds: TILE_SOURCE_BOUNDS,
    minzoom: TILE_AGGREGATION_MAX_ZOOM + 1,
    maxzoom: 16,
  });

  const steps = speciesDensitySteps();
  const densityStep = [
    "step",
    ["coalesce", ["get", "weight"], 1],
    ramp[steps[0].ramp - 1],
    ...steps.slice(1).flatMap((s) => [s.min, ramp[s.ramp - 1]]),
  ] as unknown as ExpressionSpecification;

  map.addLayer({
    id: CELL_LAYER,
    // Discrete filled cells, NOT a heatmap: MapLibre's heatmap layer is a
    // kernel density estimate, so blur is the definition of the layer rather
    // than a setting. The tiles already aggregate into cells.
    type: "fill",
    source: SOURCE_AGG,
    "source-layer": CELL_SOURCE_LAYER,
    maxzoom: TILE_AGGREGATION_MAX_ZOOM + 1,
    paint: {
      "fill-color": densityStep,
      // Neighbouring cells share an exact edge; antialiasing them draws a faint
      // hairline grid over the whole country.
      "fill-antialias": false,
      "fill-opacity": 0.9,
    },
  });

  map.addLayer({
    id: POINT_LAYER,
    type: "circle",
    source: SOURCE_PTS,
    "source-layer": CELL_SOURCE_LAYER,
    // Derived from the shared constant, so it can never drift from where the
    // endpoint actually changes regime — a mismatch is invisible in review and
    // shows up as a band of zoom levels with nothing on the map.
    minzoom: TILE_AGGREGATION_MAX_ZOOM + 1,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 3, 16, 6],
      "circle-color": ramp[5],
      "circle-stroke-width": 1,
      "circle-stroke-color": ramp[0],
      "circle-opacity": 0.95,
    },
  });
}
