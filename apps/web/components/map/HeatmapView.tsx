"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
// Types only. The runtime module is loaded from public/maplibre — see lib/map.ts
// for why it must not go through the bundler.
import type {
  Map as MLMap,
  VectorTileSource,
  ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  CATEGORIES,
  CATEGORY_KEYS,
  aggregationCellMeters,
  DENSITY_CLASSES,
  densityClassMax,
  densityStepExpression,
  filterToQuery,
  TILE_AGGREGATION_MAX_ZOOM,
  TAIWAN_MAIN_BOUNDS,
  type Category,
  type MapFilter,
} from "@conservation/shared";
import { createMap, type MapHandle } from "@/lib/map";
import MapFilters from "./MapFilters";
import { Link } from "@/i18n/navigation";

/**
 * Hide everything west of the Taiwan Strait, on the hero only.
 *
 * The hero has to clear a 400px panel on its left, which forces the window
 * roughly 2.5 degrees west — and what is 2.5 degrees west of Taiwan is Fujian.
 * That is not a framing problem with a framing solution: no padding satisfies
 * both "island clear of the panel" and "no mainland", because the two pull in
 * opposite directions.
 *
 * So the mainland is painted out. A world-sized polygon with a hole cut around
 * Taiwan, filled with the basemap's own ocean colour, sampled rather than
 * guessed — #262626 across CARTO dark_all. The hole's western edge follows the
 * median of the strait rather than a meridian, because the strait runs
 * north-east: a straight cut either clipped Penghu or let Fuzhou through.
 *
 * Deliberately NOT applied to /map. That map is an instrument, and Kinmen and
 * Matsu carry real records; hiding them there would be lying about the data
 * rather than composing a picture.
 */
const OCEAN = "#262626";
const MASK_ID = "mainland-mask";

function addMainlandMask(map: MLMap) {
  if (map.getLayer(MASK_ID)) return;
  map.addSource(MASK_ID, {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          // The world.
          [
            [-180, -85],
            [180, -85],
            [180, 85],
            [-180, 85],
            [-180, -85],
          ],
          // The hole: Taiwan, Penghu, Green Island and Orchid Island.
          [
            [119.2, 21.3],
            [119.3, 23.0],
            [119.6, 24.0],
            [120.2, 25.0],
            [120.8, 25.6],
            [122.7, 25.6],
            [122.7, 21.3],
            [119.2, 21.3],
          ],
        ],
      },
    },
  });
  map.addLayer({
    id: MASK_ID,
    type: "fill",
    source: MASK_ID,
    paint: { "fill-color": OCEAN },
  });
}

/**
 * Frame the island inside whatever container the map has been given.
 *
 * Two modes, because the two maps want opposite things.
 *
 * The hero is full bleed with the entry panel floating over its left side, so
 * the island has to sit clear of that panel — which means padding on the LEFT,
 * which drags the window west toward Fujian. That is acceptable here and only
 * here: the mainland lands underneath the panel and its scrim, at 90% black.
 *
 * The interactive map has no panel, so it takes the opposite bias. Taiwan is far
 * taller than it is wide, so any container wider than that ratio has horizontal
 * slack, and everything west of the island is China. Weighting the padding right
 * shifts the window east and fills the slack with the Pacific instead.
 *
 * Both are proportional. A constant that cleared the mainland in one container
 * left Quanzhou on screen in another, because the slack scales with width.
 */
function frameIsland(map: MLMap, mode: "hero" | "browse") {
  const { width } = map.getCanvas().getBoundingClientRect();
  const { height } = map.getCanvas().getBoundingClientRect();
  // A phone's panel spans the full width, so no horizontal inset can clear it.
  // The island moves into the upper third instead, above the panel.
  if (mode === "hero" && width < 640) {
    map.fitBounds(TAIWAN_MAIN_BOUNDS, {
      padding: {
        // Clear of the two header rows above and the panel below, so the whole
        // island sits in the band between them rather than running under the
        // panel's top edge.
        top: 130,
        bottom: Math.round(height * 0.62),
        left: 20,
        right: 20,
      },
      duration: 0,
    });
    return;
  }
  const padding =
    mode === "hero"
      ? {
          top: 40,
          bottom: 40,
          // Just past the panel: it is max-w-sm (384px) inside a centred
          // max-w-7xl, so this tracks it rather than guessing a fraction of the
          // viewport. Overshooting is not free — every pixel of left inset
          // pulls the window west toward the mainland.
          left: Math.min(Math.round(width * 0.36), 520),
          right: 24,
        }
      : { top: 8, bottom: 8, left: 0, right: Math.round(width * 0.42) };
  map.fitBounds(TAIWAN_MAIN_BOUNDS, { padding, duration: 0 });
}

/**
 * Two sources over the same endpoint, and this is what stops the map going blank
 * at the aggregation handoff.
 *
 * With a single source, crossing into the point regime hid the cells (their tiles
 * simply stop carrying polygons) while the first point tiles were still in
 * flight, and the z10 parent tile has no points to fall back on — so there was
 * genuinely nothing to draw. Measured on a continuous wheel zoom, that produced a
 * frame with 0% of the view painted.
 *
 * Capping the aggregate source at TILE_AGGREGATION_MAX_ZOOM makes MapLibre
 * *overzoom* the last aggregated tile instead of requesting one that does not
 * exist, so the cells stay on screen and fade out while the points load in
 * underneath them. The point source starts one level up, so neither source
 * fetches tiles the other regime would serve.
 */
const SOURCE_AGG = "reports-agg";
const SOURCE_PTS = "reports-pts";
const SOURCE_LAYER = "reports";
const CELL_LAYER = "reports-cells";
const DOT_LAYER = "reports-dots";
const HEAT_LAYER = "reports-heat";
const POINT_LAYER = "reports-points";
/** Second layer in the same MVT, carrying cell centroids. See the tile route. */
const DOT_SOURCE_LAYER = "reports_dots";

export type MapMode = "heat" | "bins" | "dots";
const MODES: MapMode[] = ["heat", "bins", "dots"];
const MODE_KEY = "conservation.mapMode";

/**
 * The bins/dots preference, held in localStorage and read through
 * useSyncExternalStore.
 *
 * Two simpler approaches both fail. Reading localStorage in a `useState`
 * initialiser also runs during hydration, where the server could not have known
 * the value, so React reports a hydration mismatch and refuses to patch it up.
 * Restoring it in an effect instead means calling setState synchronously in an
 * effect body, which cascades renders. useSyncExternalStore is the intended tool:
 * it renders the server snapshot during hydration and swaps to the client
 * snapshot immediately afterwards, with no mismatch and no cascade.
 *
 * The `storage` event subscription is a small bonus — flipping the toggle in one
 * tab updates any others.
 */
const modeStore = {
  listeners: new Set<() => void>(),
  get(): MapMode {
    try {
      const v = window.localStorage.getItem(MODE_KEY);
      return v === "dots" || v === "bins" || v === "heat" ? v : "bins";
    } catch {
      return "bins"; // private browsing
    }
  },
  /** The server has no preference to read, so it always renders the default. */
  getServer(): MapMode {
    return "bins";
  },
  set(m: MapMode) {
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      // Not persisted, but the in-memory notify below still updates the UI.
    }
    for (const l of modeStore.listeners) l();
  },
  subscribe(l: () => void) {
    modeStore.listeners.add(l);
    window.addEventListener("storage", l);
    return () => {
      modeStore.listeners.delete(l);
      window.removeEventListener("storage", l);
    };
  },
};

/**
 * How big a symbol representing exactly ONE report should be, at a given zoom.
 *
 * Shared deliberately between the aggregated dots (for a cell that holds a single
 * report) and the individual point layer. Aggregation keeps subdividing as you
 * zoom in — 73% of cells hold exactly one report by z13 — so by the time the two
 * regimes swap, nearly every dot already *is* one report. Sizing both from this
 * one ramp means the swap changes nothing visible: the dots simply keep breaking
 * down until they stop at individual records.
 */
const SINGLE_REPORT_RADIUS: [zoom: number, radius: number][] = [
  [6, 1.5],
  [10, 2.2],
  [13, 3.2],
  [16, 7],
];

/**
 * Multiplier on that radius for a cell holding more than one report, keyed on
 * sqrt(count) so the circle's *area* tracks the count. A single report is
 * exactly 1x, which is what makes an aggregated dot and an individual point
 * identical where the two regimes meet.
 */
const WEIGHT_MULTIPLIER: [sqrtCount: number, factor: number][] = [
  [1, 1],
  [3, 1.9],
  [6, 2.8],
  [18, 4.4],
  [36, 6],
];

const singleReportRadius = [
  "interpolate",
  ["linear"],
  ["zoom"],
  ...SINGLE_REPORT_RADIUS.flat(),
] as unknown as ExpressionSpecification;

/**
 * Dot radius: the single-report size, scaled up by how many reports the cell holds.
 *
 * The multiplier runs on the SQUARE ROOT of the count, so it is the circle's
 * *area* that tracks the number of reports. Scaling the radius directly squares
 * the visual weight and wildly overstates dense cells — the classic
 * proportional-symbol mistake. A cell holding one report gets a multiplier of
 * exactly 1, which is what makes it identical to an individual point.
 */
const dotRadius = [
  // The zoom interpolate MUST be outermost. MapLibre rejects a paint property
  // that depends on both zoom and feature data in any other shape —
  // `["*", zoomExpr, dataExpr]` fails validation with "zoom expression may only
  // be used as input to a top-level step or interpolate expression", and the
  // layer is then silently never added to the style. So the multiplication is
  // done here at build time instead: one zoom stop per entry, each carrying a
  // full data-driven ramp already scaled by that stop's base radius.
  "interpolate",
  ["linear"],
  ["zoom"],
  ...SINGLE_REPORT_RADIUS.flatMap(([zoom, base]) => [
    zoom,
    [
      "interpolate",
      ["linear"],
      ["sqrt", ["coalesce", ["get", "weight"], 1]],
      ...WEIGHT_MULTIPLIER.flatMap(([s, f]) => [s, +(base * f).toFixed(2)]),
    ],
  ]),
] as unknown as ExpressionSpecification;

/**
 * Absolute tile URL template for MapLibre.
 *
 * Built by concatenation, NOT `new URL()`. The WHATWG URL spec percent-encodes
 * `{` and `}` in a path, so `new URL()` turns `{z}/{x}/{y}` into
 * `%7Bz%7D/%7Bx%7D/%7By%7D`. MapLibre then finds no placeholders to substitute
 * and silently renders an empty layer.
 */
function tileUrl(filter: MapFilter): string {
  const qs = filterToQuery(filter);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/api/tiles/{z}/{x}/{y}${qs ? `?${qs}` : ""}`;
}

/**
 * Cell count -> colour, as a MapLibre `step` expression.
 *
 * Generated from DENSITY_CLASSES so the map and the legend below cannot disagree
 * about what a colour means.
 */
const densityStep = densityStepExpression(
  DENSITY_CLASSES,
) as unknown as ExpressionSpecification;

/**
 * Dot colour, brightening the lowest class as you zoom in.
 *
 * The lowest class is deliberately dim so that at country zoom the mass of
 * one-and-two-report cells recedes and the road corridors read. But aggregation
 * keeps subdividing, and by z13 roughly three quarters of cells hold exactly one
 * report — so at that zoom *everything* is the dim class and the map turns faint
 * right before it hands over to individual points. Down there a single report is
 * the subject, not background, so it gets the brighter treatment.
 *
 * The zoom interpolate has to stay outermost; see dotRadius for what happens
 * otherwise.
 */
const dotColor = [
  "interpolate",
  ["linear"],
  ["zoom"],
  11,
  densityStepExpression(DENSITY_CLASSES),
  13.5,
  densityStepExpression([
    { ...DENSITY_CLASSES[0], color: "#3b82f6" },
    ...DENSITY_CLASSES.slice(1),
  ]),
] as unknown as ExpressionSpecification;

/** Category -> colour, as a MapLibre `match` expression. */
const categoryColor: ExpressionSpecification = [
  "match",
  ["get", "category"],
  ...CATEGORY_KEYS.flatMap((k) => [k, CATEGORIES[k].color] as [string, string]),
  "#94a3b8",
] as unknown as ExpressionSpecification;

export default function HeatmapView({
  maptilerKey,
  years,
  initialView,
  initialFilter,
  presentation = false,
}: {
  maptilerKey?: string;
  years: { first: number; last: number } | null;
  /**
   * Hero mode: the map as a live illustration rather than an instrument.
   *
   * Drops every piece of chrome — filters, legend, mode toggle, zoom buttons,
   * scale bar, the skip link — and makes the canvas non-interactive so it cannot
   * swallow the page scroll. The full instrument lives at /map, one click away.
   */
  presentation?: boolean;
  /** Validated server-side from the query string; see parseView() in page.tsx. */
  initialView?: { center: [number, number]; zoom: number } | null;
  /** Parsed server-side with mapFilterSchema, so it is already trustworthy. */
  initialFilter?: MapFilter;
}) {
  const t = useTranslations();
  // The popup is built imperatively inside a MapLibre event handler, which closes
  // over the first render. A ref keeps it reading current translations after a
  // locale switch instead of freezing the initial language.
  const tRef = useRef(t);
  // Assigned in an effect, not during render: mutating a ref while rendering is
  // impure and breaks under React's concurrent rendering rules.
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const handleRef = useRef<MapHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<MapFilter>(initialFilter ?? {});
  const [hint, setHint] = useState<string | null>(null);
  // Bins vs dots. See modeStore above for why this is not useState.
  const mode = useSyncExternalStore(
    modeStore.subscribe,
    modeStore.get,
    modeStore.getServer,
  );
  const setMode = modeStore.set;
  // The initial camera is read exactly once. Making it a dependency of the init
  // effect would mean a later navigation could yank the map away from wherever
  // the user has since panned to.
  const cleanupRef = useRef<(() => void) | null>(null);
  const initialViewRef = useRef(initialView);
  // Read once alongside the initial camera: whether this instance is chrome-less
  // is fixed for its lifetime, and making it a dependency of the init effect
  // would tear the map down and rebuild it.
  const presentationRef = useRef(presentation);

  /* ---- init ---- */
  useEffect(() => {
    if (!container.current || handleRef.current) return;
    let cancelled = false;

    void (async () => {
      const handle = await createMap(container.current!, {
        maptilerKey,
        ...(initialViewRef.current
          ? {
              center: initialViewRef.current.center,
              zoom: initialViewRef.current.zoom,
            }
          : { zoom: 6.6 }),
        maxZoom: 16,
        // Unclamped at construction. maxBounds overrides a requested camera
        // whenever the viewport is wider than the bounds, which silently threw
        // away the framing below — the map looked identical no matter what
        // padding it was given. The limit is re-applied after the fit instead.
        bounded: false,
        static: presentationRef.current,
        onReady: addReportLayers,
      });

      // The component unmounted while MapLibre was loading.
      if (cancelled) {
        handle.destroy();
        return;
      }

      const { map, ml } = handle;
      handleRef.current = handle;
      mapRef.current = map;

      // A handle for the end-to-end specs, which need to move the map
      // deterministically. Exposed in dev, and in a build that opts in with
      // NEXT_PUBLIC_E2E — CI serves `next start`, so a NODE_ENV check alone left
      // window.__map undefined there and the page spec died on a raw TypeError.
      // A real production build still exposes nothing.
      if (
        process.env.NODE_ENV !== "production" ||
        process.env.NEXT_PUBLIC_E2E === "1"
      ) {
        (window as unknown as { __map?: MLMap }).__map = map;
      }

      if (!presentationRef.current) {
        map.addControl(
          new ml.ScaleControl({ maxWidth: 120, unit: "metric" }),
          "bottom-left",
        );
      }

      // Frame the island whenever no explicit view was asked for. That covers
      // the hero, and a first visit to /map — the fixed zoom it used before left
      // a large piece of Fujian on screen, and this map is about Taiwan. A
      // shared URL carrying lng/lat/z is honoured instead, and panning still
      // reaches Kinmen and Matsu, which do carry records.
      if (presentationRef.current || !initialViewRef.current) {
        frameIsland(map, presentationRef.current ? "hero" : "browse");
      }

      // No maxBounds. It is not a pan limit so much as a camera override:
      // whenever the viewport is wider than the bounds — which it is at country
      // zoom — MapLibre forces the view to fit them, and it does so even when
      // applied after the fact. Measured, it snapped the west edge to 117.5,
      // which is Fujian. minZoom still stops anyone zooming out to the globe,
      // and the default view is now the island.

      // Re-fit on resize only for the hero, which is a full-bleed background and
      // changes shape with the window. Doing it on the interactive map would
      // yank a browsing user back to the island the moment they resized.
      if (presentationRef.current) {
        const onResizeFit = () => frameIsland(map, "hero");
        map.on("resize", onResizeFit);
        cleanupRef.current = () => map.off("resize", onResizeFit);
      }

      // Idempotent: may be invoked more than once as the style settles.
      function addReportLayers(map: MLMap) {
        // Before the report layers, so the density cells draw over it. Called
        // from here rather than beside frameIsland because addLayer throws
        // "Style is not done loading" until this callback fires.
        if (presentationRef.current) addMainlandMask(map);

        if (map.getSource(SOURCE_AGG)) return;

        map.addSource(SOURCE_AGG, {
          type: "vector",
          tiles: [tileUrl({})],
          minzoom: 0,
          // Stops here on purpose: beyond this the endpoint serves points, so
          // MapLibre should overzoom the last aggregated tile rather than fetch
          // one with no polygons in it.
          maxzoom: TILE_AGGREGATION_MAX_ZOOM,
        });
        map.addSource(SOURCE_PTS, {
          type: "vector",
          tiles: [tileUrl({})],
          minzoom: TILE_AGGREGATION_MAX_ZOOM + 1,
          maxzoom: 16,
        });

        map.addLayer({
          id: CELL_LAYER,
          // A `fill` of discrete cells, NOT a `heatmap`.
          //
          // MapLibre's heatmap layer is a kernel density estimate: each feature
          // is splatted as a Gaussian and the splats are summed. Blur is the
          // definition of that layer, not a parameter — `heatmap-radius` and
          // `heatmap-weight` only trade how blurry against how saturated, and no
          // combination of them is sharp. The tile endpoint already aggregates
          // into cells, so the cells are drawn as themselves instead.
          type: "fill",
          source: SOURCE_AGG,
          "source-layer": SOURCE_LAYER,
          // Outlives the handoff by a little, fading, so it covers the moment the
          // point tiles are still loading.
          maxzoom: TILE_AGGREGATION_MAX_ZOOM + 2,
          paint: {
            "fill-color": densityStep,
            // Antialiasing is off deliberately. Neighbouring cells share an exact
            // edge, and an antialiased seam between two same-coloured fills shows
            // up as a faint grid of hairlines across the whole country.
            "fill-antialias": false,
            // Full strength right up to the handoff, then a short fade while the
            // overzoomed cells hand over to the real points underneath.
            "fill-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              TILE_AGGREGATION_MAX_ZOOM,
              0.85,
              TILE_AGGREGATION_MAX_ZOOM + 1,
              0.55,
              TILE_AGGREGATION_MAX_ZOOM + 1.2,
              0,
            ],
          },
        });

        // The blurry one. A kernel density estimate: MapLibre spreads each
        // point over a radius and sums the overlaps, so the colour at a pixel is
        // not any feature's count — which is exactly why bins and dots exist
        // beside it. It is kept because it reads shape and pressure across a
        // whole region better than discrete symbols do.
        map.addLayer({
          id: HEAT_LAYER,
          type: "heatmap",
          source: SOURCE_AGG,
          "source-layer": DOT_SOURCE_LAYER,
          maxzoom: TILE_AGGREGATION_MAX_ZOOM + 2,
          layout: { visibility: "none" },
          paint: {
            // Weighted by the cell's own count, so a cell holding 300 reports
            // pushes far harder than one holding 2. Capped so a single hotspot
            // cannot saturate the whole surface.
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["get", "weight"],
              0,
              0,
              1,
              0.12,
              30,
              0.5,
              300,
              1,
            ],
            "heatmap-intensity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              0.8,
              12,
              2.4,
            ],
            // Same blue -> cyan -> green -> amber -> red progression as
            // DENSITY_CLASSES, so switching modes does not relearn the colours.
            "heatmap-color": [
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
            ],
            "heatmap-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              12,
              9,
              22,
              13,
              34,
            ],
            "heatmap-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              TILE_AGGREGATION_MAX_ZOOM,
              0.9,
              TILE_AGGREGATION_MAX_ZOOM + 1.2,
              0,
            ],
          },
        });

        map.addLayer({
          id: DOT_LAYER,
          type: "circle",
          source: SOURCE_AGG,
          // A separate layer inside the same tile — the dots cannot be derived
          // from the cell polygons, because MapLibre draws a circle at every
          // vertex of a polygon and a square would produce four.
          "source-layer": DOT_SOURCE_LAYER,
          maxzoom: TILE_AGGREGATION_MAX_ZOOM + 2,
          layout: { visibility: "none" },
          paint: {
            "circle-radius": dotRadius,
            "circle-color": dotColor,
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              TILE_AGGREGATION_MAX_ZOOM,
              0.85,
              TILE_AGGREGATION_MAX_ZOOM + 1,
              0.55,
              TILE_AGGREGATION_MAX_ZOOM + 1.2,
              0,
            ],
            // A dark rim keeps overlapping circles readable as separate symbols
            // rather than merging into one blob — which is the whole point of
            // offering this mode alongside the bins.
            "circle-stroke-width": 0.5,
            "circle-stroke-color": "rgba(2,6,23,0.7)",
          },
        });

        map.addLayer({
          id: POINT_LAYER,
          type: "circle",
          source: SOURCE_PTS,
          "source-layer": SOURCE_LAYER,
          // Derived, so it can never drift from where the tile endpoint actually
          // switches regimes. A mismatch here is invisible in code review and
          // shows up as a band of zoom levels with nothing on the map.
          minzoom: TILE_AGGREGATION_MAX_ZOOM + 1,
          paint: {
            // The very same ramp the aggregated dots use for a single-report
            // cell, so a dot and the point it becomes are the same size.
            "circle-radius": singleReportRadius,
            "circle-color": categoryColor,
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              12,
              0,
              14,
              1,
            ],
            "circle-stroke-color": "rgba(255,255,255,0.65)",
            // Visible the instant this layer takes over.
            //
            // This ramp used to start at 0 and only reach 0.9 by z12.5, which was
            // fine when a heatmap stayed painted until z13.5 and cross-faded with
            // it. Once the heatmap was replaced by cells that stop dead at z10, it
            // left roughly z10-11.5 looking empty: the points were all there and
            // drawn at near-zero opacity. Zooming in made the map go blank and
            // only "come back" much later.
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11,
              0.8,
              13,
              0.9,
            ],
          },
        });

        setReady(true);
      }

      map.on("click", POINT_LAYER, (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const p = feat.properties as Record<string, unknown>;
        const cat = String(p.category ?? "") as Category;
        const tr = tRef.current;
        const label = cat in CATEGORIES ? tr(`categories.${cat}`) : cat;
        const obscured = p.obscured === true || p.obscured === "true";
        new ml.Popup({ closeButton: true, maxWidth: "260px" })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font:13px/1.5 system-ui;color:#0b1410">
               <div style="font-weight:600">${label}</div>
               <div style="color:#475569">${p.observed_on ?? ""}</div>
               ${obscured ? `<div style="margin-top:4px;color:#b45309">⚠ ${tr("map.blurred")}</div>` : ""}
             </div>`,
          )
          .addTo(map);
      });

      // Cells are readable, which the old heatmap could not be. A kernel density
      // surface has no feature under the cursor — the colour at a pixel is a sum
      // over neighbouring blobs and corresponds to no particular number. A cell
      // is a real feature with a real count, so it can answer "how many?".
      for (const layer of [CELL_LAYER, DOT_LAYER])
        map.on("click", layer, (e) => {
          const feat = e.features?.[0];
          if (!feat) return;
          const n = Number(feat.properties?.weight ?? 0);
          if (!Number.isFinite(n) || n <= 0) return;
          const tr = tRef.current;
          const km =
            Math.round(aggregationCellMeters(Math.floor(map.getZoom())) / 100) /
            10;
          new ml.Popup({ closeButton: true, maxWidth: "220px" })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font:13px/1.5 system-ui;color:#0b1410">
               <div style="font-weight:600">${tr("map.cellCount", { count: n.toLocaleString() })}</div>
               <div style="color:#475569">${tr("map.cellSize", { km })}</div>
               <div style="margin-top:4px;color:#475569">${tr("map.zoomHint")}</div>
             </div>`,
            )
            .addTo(map);
        });

      for (const layer of [POINT_LAYER, CELL_LAYER, DOT_LAYER]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      map.on("zoomend", () => {
        setHint(
          map.getZoom() >= TILE_AGGREGATION_MAX_ZOOM + 0.5
            ? null
            : tRef.current("map.zoomHint"),
        );
      });
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      handleRef.current?.destroy();
      handleRef.current = null;
      mapRef.current = null;
    };
  }, [maptilerKey]);

  /* ---- keep the address bar in step with the map ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    // history.replaceState directly, NOT router.replace. The Next router treats a
    // query change as a navigation and refetches the server component on every
    // pan, which throws away the map for a fresh render. This only needs the URL
    // to be copy-pasteable, so writing it straight to history is both correct and
    // free.
    const sync = () => {
      const c = map.getCenter();
      const params = new URLSearchParams(filterToQuery(filter));
      params.set("lng", c.lng.toFixed(4));
      params.set("lat", c.lat.toFixed(4));
      params.set("z", map.getZoom().toFixed(2));
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?${params}`,
      );
    };

    // Debounced: `moveend` fires once per gesture, but a wheel zoom is a rapid
    // burst of them.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMoveEnd = () => {
      clearTimeout(timer);
      timer = setTimeout(sync, 300);
    };
    map.on("moveend", onMoveEnd);
    // Deliberately NOT synced on mount: landing on "/" should keep a clean URL
    // rather than instantly rewriting it to the default position. The address bar
    // starts reflecting the view as soon as the reader actually moves or filters.
    if (Object.keys(filter).length > 0) sync();
    return () => {
      clearTimeout(timer);
      map.off("moveend", onMoveEnd);
    };
  }, [ready, filter]);

  /* ---- heat vs bins vs dots ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // Both geometries ride in the same tile, so switching is a visibility flip
    // with no refetch.
    map.setLayoutProperty(
      CELL_LAYER,
      "visibility",
      mode === "bins" ? "visible" : "none",
    );
    map.setLayoutProperty(
      DOT_LAYER,
      "visibility",
      mode === "dots" ? "visible" : "none",
    );
    map.setLayoutProperty(
      HEAT_LAYER,
      "visibility",
      mode === "heat" ? "visible" : "none",
    );
    // Persistence is modeStore.set's job; doing it here too would be a second
    // source of truth for the same value.
  }, [mode, ready]);

  /* ---- filters: repoint the source, which re-keys the CDN cache too ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // Both sources point at the same endpoint and must be repointed together, or
    // the two zoom regimes end up showing different filters.
    for (const id of [SOURCE_AGG, SOURCE_PTS]) {
      const src = map.getSource(id) as VectorTileSource | undefined;
      src?.setTiles([tileUrl(filter)]);
    }
    // Every filter lives in the tile query string, so the CDN keys on it too.
    // Depending on the individual fields rather than the `filter` object avoids
    // re-running on every render just because the object identity changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, filter.category, filter.taxonId, filter.from, filter.to]);

  return (
    <div className="relative h-full w-full">
      {/*
        Sized with h-full rather than `absolute inset-0`: maplibre-gl.css is
        unlayered and sets `.maplibregl-map { position: relative }`, which beats
        Tailwind 4's layered `.absolute` utility (unlayered CSS wins over
        @layer). The element would stay position:relative and collapse to 0px.
      */}
      {/*
        A WebGL canvas conveys nothing to assistive technology, so the region is
        labelled and paired with a link to the equivalent table at /reports.
      */}
      {/*
        Before the map in DOM order, deliberately. This is a skip link: it is
        offscreen until focused, and its whole purpose is to offer the tabular
        equivalent *without* first traversing a canvas the reader cannot use.
        Placed after the map it became the twelfth tab stop, behind the canvas,
        both zoom buttons and the attribution — which is no use to anyone.

        `sr-only`, not a negative translate. Hiding it with `-translate-y-16`
        assumed the offset moved it off the top of the screen, but this element's
        containing block starts *below* the site header, so it translated up into
        the header instead — where it sat permanently visible over the wordmark,
        at both desktop and phone widths.
      */}
      {!presentation && (
        <Link
          href={{
            pathname: "/reports",
            query: Object.fromEntries(
              new URLSearchParams(filterToQuery(filter)),
            ),
          }}
          // Every visual utility sits behind `focus:`. Left unqualified they
          // fight `sr-only` — padding overrides its `padding: 0` and leaves a
          // 24x12 phantom box in the layout even though the clip stops it
          // painting.
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-30 focus:rounded-full focus:bg-parchment-50 focus:px-3 focus:py-1.5 focus:text-xs focus:font-medium focus:text-bark-950"
        >
          {t("list.viewAsList")}
        </Link>
      )}
      <div
        ref={container}
        className="relative h-full w-full"
        // In presentation mode this is decoration, not an application: it takes
        // no input and offers nothing to announce. Labelling it would put a
        // dead-end "application" region in the reader's path on the home page.
        {...(presentation
          ? { "aria-hidden": true }
          : { role: "application", "aria-label": t("map.regionLabel") })}
      />

      {/* pr leaves room for the zoom control in the top-right corner: at phone
          width the chip row wrapped straight under the +/- buttons. (Comment
          outside the && — as its first child it parses as an object literal.) */}
      {!presentation && (
        <div className="pointer-events-none absolute left-0 right-0 top-0 p-3 pr-14 sm:p-4 sm:pr-16">
          <MapFilters value={filter} onChange={setFilter} years={years} />
        </div>
      )}

      {/* Mode toggle + legend. Kept clear of the attribution bar, which is
          bottom-right and had been cutting the legend's caption off. */}
      {!presentation && (
        <div className="pointer-events-auto absolute bottom-16 right-3 sm:bottom-12 sm:right-4">
          <div className="rounded-lg border border-parchment-200/15 bg-bark-900/80 px-3 py-2 text-[11px] text-parchment-300 backdrop-blur">
            <div
              role="group"
              aria-label={t("map.displayMode")}
              className="mb-2 flex rounded-md border border-parchment-200/15 p-0.5"
            >
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`flex-1 rounded px-2 py-1 text-[11px] transition ${
                    mode === m
                      ? "bg-parchment-50/90 font-medium text-bark-950"
                      : "text-parchment-300 hover:bg-parchment-50/10"
                  }`}
                >
                  {t(`map.mode.${m}`)}
                </button>
              ))}
            </div>

            <div className="mb-1 font-medium text-parchment-200">
              {t("map.density")}
            </div>

            {/* Swatches with real counts, not a gradient bar. The gradient was
                unreadable by design: you could see that one area was hotter than
                another but had no way to recover a number. In dots mode the same
                classes are shown at their actual circle size, so the legend
                explains both channels the symbol uses. */}
            <ul className="space-y-0.5">
              {DENSITY_CLASSES.map((c, i) => {
                const max = densityClassMax(i);
                const label =
                  max === null
                    ? `${c.min}+`
                    : c.min === max
                      ? `${c.min}`
                      : `${c.min}–${max}`;
                return (
                  <li key={c.min} className="flex items-center gap-1.5">
                    <span className="flex w-4 shrink-0 justify-center">
                      <span
                        aria-hidden
                        className={
                          mode === "dots" ? "rounded-full" : "rounded-[2px]"
                        }
                        style={
                          mode === "dots"
                            ? {
                                background: c.color,
                                // Same sqrt-of-count scale the map uses, so the
                                // legend cannot imply a different relationship.
                                width: `${Math.min(14, 3 + Math.sqrt(c.min) * 1.1).toFixed(1)}px`,
                                height: `${Math.min(14, 3 + Math.sqrt(c.min) * 1.1).toFixed(1)}px`,
                              }
                            : {
                                background: c.color,
                                width: "10px",
                                height: "10px",
                              }
                        }
                      />
                    </span>
                    <span className="tabular-nums text-parchment-400">
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1 border-t border-parchment-200/10 pt-1 text-[10px] text-parchment-500">
              {t("map.perCell")}
            </div>
          </div>
        </div>
      )}

      {hint && !presentation && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-parchment-200/15 bg-bark-900/85 px-3 py-1.5 text-[11px] text-parchment-300 backdrop-blur">
          {hint}
        </div>
      )}
    </div>
  );
}
