"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ExpressionSpecification } from "maplibre-gl";
import { createMap, type MapHandle } from "@/lib/map";
import {
  densityStepExpression,
  SPECIES_DENSITY_CLASSES,
  TAIWAN_CENTER,
  TAIWAN_MAIN_BOUNDS,
  TILE_AGGREGATION_MAX_ZOOM,
} from "@conservation/shared";

const SOURCE_ID = "species-reports";

/**
 * Records for one species.
 *
 * Reuses the same tile endpoint as the main map with a `taxonId` filter, so
 * location blurring is inherited rather than reimplemented — a sensitive species
 * is blurred here for exactly the same reason it is blurred everywhere else.
 *
 * `mode` switches presentation by record volume: a density surface built from
 * three points is meaningless, so sparse species get plain dots instead.
 */
export default function SpeciesMap({
  taxonId,
  mode,
  maptilerKey,
}: {
  taxonId: number;
  mode: "heat" | "points";
  maptilerKey?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MapHandle | null>(null);

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
        handle.map.fitBounds(TAIWAN_MAIN_BOUNDS, { padding: 12, duration: 0 });
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

        if (mode === "heat") {
          map.addLayer({
            id: "species-cells",
            // Discrete filled cells, not a heatmap — same reasoning as the main
            // map: MapLibre's heatmap layer is a kernel density estimate, so blur
            // is intrinsic to it rather than a setting. See DENSITY_CLASSES.
            type: "fill",
            source: SOURCE_ID,
            "source-layer": "reports",
            maxzoom: TILE_AGGREGATION_MAX_ZOOM + 1,
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
        } else {
          map.addLayer({
            id: "species-points",
            type: "circle",
            source: SOURCE_ID,
            "source-layer": "reports",
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5,
                4,
                10,
                7,
              ],
              "circle-color": "#34d399",
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(255,255,255,0.7)",
              "circle-opacity": 0.9,
            },
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [taxonId, mode, maptilerKey]);

  return (
    <div
      ref={container}
      // See LocationPicker: the container must be positioned or the canvas
      // escapes to the viewport.
      className="relative h-64 w-full overflow-hidden rounded-lg sm:h-80"
    />
  );
}
