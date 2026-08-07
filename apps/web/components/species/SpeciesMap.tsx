"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ExpressionSpecification } from "maplibre-gl";
import { createMap, type MapHandle } from "@/lib/map";
import MapModeToggle from "@/components/map/MapModeToggle";
import { useMapMode, type MapMode } from "@/components/map/mapMode";
import {
  densityStepExpression,
  SPECIES_DENSITY_CLASSES,
  TAIWAN_CENTER,
  TAIWAN_MAIN_BOUNDS,
  TILE_AGGREGATION_MAX_ZOOM,
} from "@conservation/shared";

const SOURCE_ID = "species-reports";
const CELLS = "species-cells";
const DOTS = "species-dots";
const HEAT = "species-heat";
/** Cell centroids, a second layer inside the same MVT. See the tile route. */
const DOT_SOURCE_LAYER = "reports_dots";

/**
 * Below this many records the kernel density view is not offered.
 *
 * A KDE spreads each point over a radius and sums the overlaps, so over a
 * handful of records it draws smooth blobs that describe the estimator rather
 * than the species. The other two views degrade honestly — six cells look like
 * six cells — so only this one needs a floor.
 */
const HEAT_MIN_RECORDS = 40;

/**
 * Records for one species.
 *
 * Reuses the same tile endpoint as the main map with a `taxonId` filter, so
 * location blurring is inherited rather than reimplemented — a sensitive species
 * is blurred here for exactly the same reason it is blurred everywhere else.
 *
 * Carries the same heat/bins/dots toggle as /map, reading the same shared
 * preference, so a choice made on one map holds on the other. It used to pick a
 * representation for you from the record count and give you no say.
 *
 * The one thing still decided for you is whether *heat* is on the menu at all:
 * see HEAT_MIN_RECORDS.
 */
export default function SpeciesMap({
  taxonId,
  reportCount,
  maptilerKey,
}: {
  taxonId: number;
  reportCount: number;
  maptilerKey?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MapHandle | null>(null);
  const [stored, setMode] = useMapMode();
  const allowHeat = reportCount >= HEAT_MIN_RECORDS;
  // Falls back rather than showing an empty map when the shared preference is
  // heat and this species is too sparse for it.
  const mode: MapMode = stored === "heat" && !allowHeat ? "dots" : stored;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const map = handleRef.current?.map;
    if (map) applyMode(map, mode);
  }, [mode]);

  useEffect(() => {
    if (!container.current || handleRef.current) return;
    let cancelled = false;

    void (async () => {
      const handle = await createMap(container.current!, {
        maptilerKey,
        center: TAIWAN_CENTER,
        zoom: 6.2,
        navigation: false,
        // maxBounds fights the fitBounds below: when the container is wider than
        // the bounds — which this one is on a desktop, being a short wide panel —
        // MapLibre overrides the requested camera to make the bounds fit, and the
        // island came out cropped at the bottom. Same clamp that broke the hero.
        bounded: false,
        onReady: addLayers,
      });
      if (cancelled) return handle.destroy();
      handleRef.current = handle;

      // A fixed centre and zoom frames the island for one container shape only.
      // This map is as wide as its column, so on a phone the same zoom 6.2 cut
      // the east coast off. Fitting the bounds lets MapLibre do the arithmetic
      // for whatever width it is actually given.
      const fit = () =>
        // Weighted east, like /map: Taiwan is far taller than it is wide, so a
        // container wider than that ratio has horizontal slack, and everything
        // west of the island is Fujian. Symmetric padding put the mainland in
        // every species panel on the site.
        handle.map.fitBounds(TAIWAN_MAIN_BOUNDS, {
          padding: {
            top: 10,
            bottom: 10,
            left: 0,
            right: Math.round(
              handle.map.getCanvas().getBoundingClientRect().width * 0.52,
            ),
          },
          duration: 0,
        });
      fit();
      handle.map.on("resize", fit);

      function addLayers(map: MapHandle["map"]) {
        if (map.getSource(SOURCE_ID)) return;

        // Built by concatenation, not new URL(): the URL spec percent-encodes
        // `{` and `}`, which stops MapLibre substituting the tile placeholders.
        const tiles = `${window.location.origin}/api/tiles/{z}/{x}/{y}?taxonId=${taxonId}`;
        map.addSource(SOURCE_ID, {
          type: "vector",
          tiles: [tiles],
          minzoom: 0,
          maxzoom: 16,
        });

        map.addLayer({
          id: HEAT,
          type: "heatmap",
          source: SOURCE_ID,
          "source-layer": DOT_SOURCE_LAYER,
          maxzoom: TILE_AGGREGATION_MAX_ZOOM + 2,
          layout: { visibility: "none" },
          paint: {
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["coalesce", ["get", "weight"], 1],
              0,
              0,
              1,
              0.25,
              20,
              1,
            ],
            "heatmap-intensity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              0.7,
              12,
              2,
            ],
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(0,0,0,0)",
              0.2,
              "rgba(56,132,255,0.5)",
              0.45,
              "rgba(34,211,238,0.68)",
              0.7,
              "rgba(52,211,153,0.8)",
              1,
              "rgba(251,146,60,0.9)",
            ],
            "heatmap-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              14,
              10,
              26,
            ],
          },
        });

        map.addLayer({
          id: CELLS,
          // Discrete filled cells. MapLibre's heatmap layer is a kernel density
          // estimate, so blur is intrinsic to it rather than a setting — which
          // is why that view is separate and gated, not the only option.
          type: "fill",
          source: SOURCE_ID,
          "source-layer": "reports",
          maxzoom: TILE_AGGREGATION_MAX_ZOOM + 1,
          layout: { visibility: "none" },
          paint: {
            "fill-color": densityStepExpression(
              SPECIES_DENSITY_CLASSES,
            ) as unknown as ExpressionSpecification,
            // Neighbouring cells share an exact edge; antialiasing them draws a
            // faint hairline grid across the whole map.
            "fill-antialias": false,
            "fill-opacity": 0.85,
          },
        });

        map.addLayer({
          id: DOTS,
          type: "circle",
          source: SOURCE_ID,
          "source-layer": DOT_SOURCE_LAYER,
          layout: { visibility: "none" },
          paint: {
            // Area tracks the count, so the radius runs on its square root —
            // scaling the radius directly squares the visual weight.
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              [
                "interpolate",
                ["linear"],
                ["sqrt", ["coalesce", ["get", "weight"], 1]],
                1,
                3,
                6,
                7,
              ],
              10,
              [
                "interpolate",
                ["linear"],
                ["sqrt", ["coalesce", ["get", "weight"], 1]],
                1,
                5,
                6,
                12,
              ],
            ],
            "circle-color": "#34d399",
            "circle-stroke-width": 1,
            "circle-stroke-color": "rgba(255,255,255,0.7)",
            "circle-opacity": 0.9,
          },
        });

        applyMode(map, modeRef.current);
      }
    })();

    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [taxonId, mode, maptilerKey]);

  return (
    <div className="relative">
      <MapModeToggle
        mode={mode}
        onChange={setMode}
        modes={allowHeat ? undefined : ["bins", "dots"]}
        className="absolute right-2 top-2 z-10 bg-bark-900/85 backdrop-blur"
      />
      <div
        ref={container}
        // See LocationPicker: the container must be positioned or the canvas
        // escapes to the viewport.
        className="relative h-64 w-full overflow-hidden rounded-lg sm:h-80"
      />
    </div>
  );
}

/** Only one of the three is ever visible. */
function applyMode(map: MapHandle["map"], mode: MapMode) {
  const want: Record<string, boolean> = {
    [HEAT]: mode === "heat",
    [CELLS]: mode === "bins",
    [DOTS]: mode === "dots",
  };
  for (const [id, on] of Object.entries(want)) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    }
  }
}
