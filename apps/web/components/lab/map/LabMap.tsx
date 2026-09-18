"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
// Types only. The runtime module is loaded from public/maplibre — see lib/map.ts
// for why it must not go through the bundler.
import type {
  Map as MLMap,
  ExpressionSpecification,
  VectorTileSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./labmap.css";
import {
  DENSITY_CLASSES,
  TAIWAN_MAIN_BOUNDS,
  TILE_AGGREGATION_MAX_ZOOM,
  TILE_SOURCE_BOUNDS,
  aggregationCellMeters,
  densityClassMax,
  densityStepExpression,
  filterToQuery,
  type MapFilter,
} from "@conservation/shared";
import { Link } from "@/i18n/navigation";
import { withBase } from "@/lib/basePath";
import { createLabMap, type LabMapHandle } from "@/lib/lab/createLabMap";
import {
  firstPlaceLabelId,
  readMapScheme,
  withAlpha,
  type LabMapScheme,
} from "@/lib/lab/mapScheme";
import type { LabCopy } from "@/lib/lab/copy";
import Button from "@/components/lab/ui/Button";
import Filter from "@/components/lab/ui/Filter";
import Legend, { type LegendSwatch } from "@/components/lab/ui/Legend";
import Notice from "@/components/lab/ui/Notice";
import LabMapControls, { type SpeciesHit } from "./LabMapControls";
import LabRecordPanel from "./LabRecordPanel";
import type { LabMapColour, LabMapMode } from "./modes";

/* ------------------------------------------------------------------ *
 * Sources and layers
 *
 * Carried over from `components/map/HeatmapView.tsx` unchanged in structure,
 * because the structure is the part that was expensive to get right — two
 * sources over one endpoint so the aggregation handoff does not blank the map,
 * a `fill` of discrete cells rather than a blurred kernel, dot area keyed on
 * the square root of the count, and every zoom `interpolate` kept outermost
 * because MapLibre silently refuses a paint property that mixes zoom and data
 * in any other shape. Only the colours are this direction's.
 * ------------------------------------------------------------------ */

const SOURCE_AGG = "lab-reports-agg";
const SOURCE_PTS = "lab-reports-pts";
const SOURCE_LAYER = "reports";
/** Second layer in the same MVT, carrying cell centroids. See the tile route. */
const DOT_SOURCE_LAYER = "reports_dots";
const CELL_LAYER = "lab-reports-cells";
const DOT_LAYER = "lab-reports-dots";
const HEAT_LAYER = "lab-reports-heat";
const POINT_LAYER = "lab-reports-points";
const SELECT_HALO_LAYER = "lab-reports-select-halo";
const SELECT_RING_LAYER = "lab-reports-select-ring";

/** How big a symbol representing exactly ONE report is, at a given zoom. */
const SINGLE_REPORT_RADIUS: [zoom: number, radius: number][] = [
  [6, 1.5],
  [10, 2.2],
  [13, 3.2],
  [16, 7],
];

/** Multiplier for a cell holding more than one, keyed on sqrt so AREA tracks count. */
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

const dotRadius = [
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

/** A ring of the selected record, sized off the same ramp the point uses. */
const ringRadius = (extra: number) =>
  [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...SINGLE_REPORT_RADIUS.flatMap(([zoom, base]) => [zoom, base + extra]),
  ] as unknown as ExpressionSpecification;

/** Below a two-thirds majority a cell has no honest type, and is drawn mixed. */
const MIXED_BELOW = 0.667;

const HAS_MAJORITY: ExpressionSpecification = [
  ">=",
  ["coalesce", ["get", "top_share"], 1],
  MIXED_BELOW,
] as unknown as ExpressionSpecification;

/** Cell count -> colour, over this direction's ramp and the shared breaks. */
function densityStep(scheme: LabMapScheme): ExpressionSpecification {
  return densityStepExpression(
    DENSITY_CLASSES.map((c, i) => ({ min: c.min, color: scheme.ramp[i] })),
  ) as unknown as ExpressionSpecification;
}

/** Aggregated cell -> the colour of whichever type dominates it. */
function groupColour(scheme: LabMapScheme): ExpressionSpecification {
  return [
    "case",
    ["<", ["coalesce", ["get", "top_share"], 1], MIXED_BELOW],
    scheme.mixed,
    [
      "match",
      ["get", "top_group"],
      "roadkill",
      scheme.marks.roadkill,
      "invasive",
      scheme.marks.invasive,
      "sighting",
      scheme.marks.sighting,
      scheme.mixed,
    ],
  ] as unknown as ExpressionSpecification;
}

/**
 * Type by FORM, not by hue.
 *
 * A sighting is a hollow ring: its fill goes transparent and the stroke carries
 * the colour and the weight. Roadkill and invasive stay solid and differ from
 * each other by lightness as well as hue (ember against parchment is 2.5:1), so
 * the three marks survive dichromacy, sunlight and a dark ground — which is the
 * whole reason the review asked for shapes rather than a palette.
 */
const HOLLOW_GROUP: ExpressionSpecification = [
  "all",
  HAS_MAJORITY,
  ["==", ["get", "top_group"], "sighting"],
] as unknown as ExpressionSpecification;

const HOLLOW_CATEGORY: ExpressionSpecification = [
  "==",
  ["get", "category"],
  "sighting",
] as unknown as ExpressionSpecification;

function categoryColour(scheme: LabMapScheme): ExpressionSpecification {
  return [
    "match",
    ["get", "category"],
    "roadkill",
    scheme.marks.roadkill,
    "injured",
    scheme.marks.injured,
    "invasive",
    scheme.marks.invasive,
    "sighting",
    scheme.marks.sighting,
    scheme.mixed,
  ] as unknown as ExpressionSpecification;
}

const hollowCase = (
  test: ExpressionSpecification,
  hollow: string | number,
  solid: ExpressionSpecification | string | number,
) => ["case", test, hollow, solid] as unknown as ExpressionSpecification;

/**
 * Absolute tile URL template for MapLibre.
 *
 * Built by concatenation, NOT `new URL()`: the WHATWG URL spec percent-encodes
 * `{` and `}` in a path, MapLibre then finds no placeholders to substitute, and
 * the layer renders empty with no error.
 */
function tileUrl(filter: MapFilter): string {
  const qs = filterToQuery(filter);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}${withBase("/api/tiles")}/{z}/{x}/{y}${qs ? `?${qs}` : ""}`;
}

/**
 * Frame the island in the middle of whatever canvas it has.
 *
 * The live map weights its padding to the right by 42% of the width, which
 * pushes the window east until the clearest place labels on screen are Japan's
 * Sakishima islands. That was a workaround for a panel floating over the map.
 * Here the panel is docked — it takes its 320px out of the layout — so the
 * canvas contains nothing but map and the island can simply sit in the middle
 * of it.
 *
 * The vertical padding leaves room for the phone's legend strip, which is real
 * furniture and not a bias: the horizontal padding is equal, which is the part
 * that decides where on the earth the window sits.
 */
function frameIsland(map: MLMap) {
  const { width } = map.getCanvas().getBoundingClientRect();
  const phone = width < 768;
  // 16 on a phone ("the island fits the width with 16px padding") and 64 on a
  // desktop, both straight off direction.md's gap scale. The desktop figure is
  // generous on purpose and it is also what keeps the budget: a tight fit on a
  // 1120px canvas lands the zoom a hair over 7, which is the level where a
  // centred window reaches one tile column further west than the live map's
  // does — a column of Fujian and open sea that costs a tile fetch and shows
  // nothing. Framing wider drops the whole view to the next tile level.
  const pad = phone ? 16 : 64;
  map.fitBounds(TAIWAN_MAIN_BOUNDS, {
    padding: {
      // Equal left and right, which is the part that decides where on the earth
      // the window sits. The vertical insets clear the phone's own furniture —
      // the filter sign above, the legend strip and the credit below — which is
      // real layout rather than a thumb on the framing.
      top: pad + (phone ? 56 : 0),
      bottom: pad + (phone ? 40 : 0),
      left: pad,
      right: pad,
    },
    duration: 0,
  });
}

export default function LabMap({
  maptilerKey,
  years,
  initialView,
  initialFilter,
  initialSpecies = null,
  mapHref,
  copy,
}: {
  maptilerKey?: string;
  years: { first: number; last: number } | null;
  initialView?: { center: [number, number]; zoom: number } | null;
  initialFilter?: MapFilter;
  initialSpecies?: SpeciesHit | null;
  mapHref: string;
  copy: LabCopy;
}) {
  const t = useTranslations();
  // The layer callbacks are built once inside the init effect and close over
  // the first render, so a ref keeps them reading current translations after a
  // locale switch rather than freezing the initial language.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const handleRef = useRef<LabMapHandle | null>(null);
  const schemeRef = useRef<LabMapScheme | null>(null);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<MapFilter>(initialFilter ?? {});
  const filterRef = useRef<MapFilter>(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const [mode, setMode] = useState<LabMapMode>("bins");
  const [colour, setColour] = useState<LabMapColour>("density");
  const [zoom, setZoom] = useState(initialView?.zoom ?? 6.6);
  const [selected, setSelected] = useState<string | null>(null);
  const [cell, setCell] = useState<{ count: number; metres: number } | null>(
    null,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const initialViewRef = useRef(initialView);

  /* ---- init ---- */
  useEffect(() => {
    if (!container.current || handleRef.current) return;
    let cancelled = false;

    void (async () => {
      // Read off the map's own element, which is inside `[data-direction]`, so
      // the basemap cannot disagree with the page around it about what the
      // island is coloured.
      const scheme = readMapScheme(container.current!);
      schemeRef.current = scheme;

      const handle = await createLabMap(container.current!, {
        scheme,
        maptilerKey,
        ...(initialViewRef.current
          ? {
              center: initialViewRef.current.center,
              zoom: initialViewRef.current.zoom,
            }
          : { zoom: 6.6 }),
        maxZoom: 16,
        onReady: addReportLayers,
      });

      if (cancelled) {
        handle.destroy();
        return;
      }

      const { map, ml } = handle;
      handleRef.current = handle;
      mapRef.current = map;

      // A handle for the budget script, which has to read the camera to say
      // whether the framing changed the number of tiles asked for. Dev and an
      // explicit E2E build only; a real production build exposes nothing.
      if (
        process.env.NODE_ENV !== "production" ||
        process.env.NEXT_PUBLIC_E2E === "1"
      ) {
        (window as unknown as { __labMap?: MLMap }).__labMap = map;
      }

      map.addControl(
        new ml.ScaleControl({ maxWidth: 120, unit: "metric" }),
        "bottom-left",
      );

      // Before the sources exist, so the first tiles requested are for the
      // final camera rather than for the default one.
      if (!initialViewRef.current) frameIsland(map);

      function addReportLayers(map: MLMap) {
        if (map.getSource(SOURCE_AGG)) return;
        const scheme = schemeRef.current;
        if (!scheme) return;

        // Under the place names and over everything else. A map whose densest
        // areas are the ones whose town names are buried is a map you cannot
        // say anything about.
        const before = firstPlaceLabelId(map.getStyle());

        // Created in their final state — the current filter, mode and colour.
        // Creating them in a default state and correcting them once `ready` is
        // set paints the wrong thing for a moment and re-requests every tile.
        const firstUrl = tileUrl(filterRef.current);
        const byType = colour === "type";
        const density = densityStep(scheme);
        const group = groupColour(scheme);

        map.addSource(SOURCE_AGG, {
          type: "vector",
          tiles: [firstUrl],
          // Never ask for a tile that cannot hold a report. See TILE_SOURCE_BOUNDS.
          bounds: TILE_SOURCE_BOUNDS,
          minzoom: 0,
          // Stops here so MapLibre overzooms the last aggregated tile rather
          // than fetching one the endpoint serves as points.
          maxzoom: TILE_AGGREGATION_MAX_ZOOM,
        });
        map.addSource(SOURCE_PTS, {
          type: "vector",
          tiles: [firstUrl],
          bounds: TILE_SOURCE_BOUNDS,
          minzoom: TILE_AGGREGATION_MAX_ZOOM + 1,
          maxzoom: 16,
        });

        map.addLayer(
          {
            id: HEAT_LAYER,
            type: "heatmap",
            source: SOURCE_AGG,
            "source-layer": DOT_SOURCE_LAYER,
            maxzoom: TILE_AGGREGATION_MAX_ZOOM + 2,
            layout: { visibility: mode === "heat" ? "visible" : "none" },
            paint: {
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
              // The same six classes the grid uses, as a gradient. The zero stop
              // is ramp 1 at zero alpha rather than transparent black, because
              // MapLibre interpolates the alpha channel with the other three and
              // a black zero stop puts a dark fringe around every hotspot.
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                withAlpha(scheme.ramp[0], 0),
                0.15,
                withAlpha(scheme.ramp[0], 0.6),
                0.35,
                withAlpha(scheme.ramp[1], 0.75),
                0.55,
                withAlpha(scheme.ramp[2], 0.85),
                0.75,
                withAlpha(scheme.ramp[3], 0.9),
                0.9,
                withAlpha(scheme.ramp[4], 0.95),
                1,
                scheme.ramp[5],
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
          },
          before,
        );

        map.addLayer(
          {
            id: CELL_LAYER,
            // A `fill` of discrete cells, NOT a `heatmap`. MapLibre's heatmap
            // layer is a kernel density estimate, so blur is the definition of
            // it rather than a parameter, and the tile endpoint has already
            // aggregated into cells that can be drawn as themselves.
            type: "fill",
            source: SOURCE_AGG,
            "source-layer": SOURCE_LAYER,
            maxzoom: TILE_AGGREGATION_MAX_ZOOM + 2,
            layout: { visibility: mode === "bins" ? "visible" : "none" },
            paint: {
              "fill-color": byType ? group : density,
              // Off deliberately: neighbouring cells share an exact edge, and an
              // antialiased seam between two same-coloured fills shows up as a
              // faint grid of hairlines across the whole country.
              "fill-antialias": false,
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
          },
          before,
        );

        map.addLayer(
          {
            id: DOT_LAYER,
            type: "circle",
            source: SOURCE_AGG,
            // A separate layer in the same tile: dots cannot be derived from the
            // cell polygons, because MapLibre draws a circle at every vertex and
            // a square would produce four.
            "source-layer": DOT_SOURCE_LAYER,
            maxzoom: TILE_AGGREGATION_MAX_ZOOM + 2,
            layout: { visibility: mode === "dots" ? "visible" : "none" },
            paint: {
              "circle-radius": dotRadius,
              "circle-color": byType
                ? hollowCase(HOLLOW_GROUP, "transparent", group)
                : density,
              "circle-stroke-width": byType
                ? hollowCase(HOLLOW_GROUP, 2, 0.5)
                : 0.5,
              "circle-stroke-color": byType
                ? hollowCase(HOLLOW_GROUP, scheme.marks.sighting, scheme.halo)
                : scheme.halo,
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
              // The live map fades only the fill, so its rims stay painted over
              // the points that replace them. A hollow mark is nothing BUT rim,
              // so here the stroke has to fade with it.
              "circle-stroke-opacity": [
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
          },
          before,
        );

        map.addLayer(
          {
            id: POINT_LAYER,
            type: "circle",
            source: SOURCE_PTS,
            "source-layer": SOURCE_LAYER,
            // Derived, so it can never drift from where the endpoint actually
            // switches regimes; a mismatch shows up as a band of zoom levels
            // with nothing on the map and is invisible in review.
            minzoom: TILE_AGGREGATION_MAX_ZOOM + 1,
            paint: {
              // The very same ramp the aggregated dots use for a single-report
              // cell, so a dot and the point it becomes are the same size.
              "circle-radius": singleReportRadius,
              "circle-color": hollowCase(
                HOLLOW_CATEGORY,
                "transparent",
                categoryColour(scheme),
              ),
              "circle-stroke-width": hollowCase(HOLLOW_CATEGORY, 2, 1),
              "circle-stroke-color": hollowCase(
                HOLLOW_CATEGORY,
                scheme.marks.sighting,
                scheme.halo,
              ),
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
          },
          before,
        );

        // The selected record: a ring separated from the mark by a halo, so it
        // reads on top of six density classes and of its own colour.
        map.addLayer(
          {
            id: SELECT_HALO_LAYER,
            type: "circle",
            source: SOURCE_PTS,
            "source-layer": SOURCE_LAYER,
            minzoom: TILE_AGGREGATION_MAX_ZOOM + 1,
            filter: ["==", ["get", "id"], ""],
            paint: {
              "circle-radius": ringRadius(2),
              "circle-color": "transparent",
              "circle-stroke-width": 2,
              "circle-stroke-color": scheme.selectHalo,
            },
          },
          before,
        );
        map.addLayer(
          {
            id: SELECT_RING_LAYER,
            type: "circle",
            source: SOURCE_PTS,
            "source-layer": SOURCE_LAYER,
            minzoom: TILE_AGGREGATION_MAX_ZOOM + 1,
            filter: ["==", ["get", "id"], ""],
            paint: {
              "circle-radius": ringRadius(4),
              "circle-color": "transparent",
              "circle-stroke-width": 3,
              "circle-stroke-color": scheme.selectRing,
            },
          },
          before,
        );

        setReady(true);
      }

      map.on("click", POINT_LAYER, (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const id = String((feat.properties as Record<string, unknown>).id ?? "");
        if (id) {
          setCell(null);
          setSelected(id);
        }
      });

      // A cell is a real feature with a real count, so it can answer "how
      // many?" — which the old kernel-density surface never could. The answer
      // goes into the detail panel rather than into a floating bubble: a popup
      // is a rounded translucent thing anchored to a moving point, and this
      // design has neither pills nor floating surfaces.
      for (const layer of [CELL_LAYER, DOT_LAYER])
        map.on("click", layer, (e) => {
          // The cells outlive the handoff while the points fade in over them,
          // so one click used to land on both. The specific record wins over
          // the cell it happens to sit in.
          if (
            map.queryRenderedFeatures(e.point, { layers: [POINT_LAYER] }).length
          )
            return;
          const feat = e.features?.[0];
          if (!feat) return;
          const count = Number(feat.properties?.weight ?? 0);
          if (!Number.isFinite(count) || count <= 0) return;
          setSelected(null);
          setCell({
            count,
            metres: aggregationCellMeters(Math.floor(map.getZoom())),
          });
        });

      for (const layer of [POINT_LAYER, CELL_LAYER, DOT_LAYER]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      // The legend is generated from the layer, the colour AND the zoom, so it
      // has to know when the map crosses into the individual-record regime.
      map.on("zoomend", () => setZoom(map.getZoom()));
    })();

    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
      mapRef.current = null;
    };
    // The initial camera and the first mode are read exactly once: making them
    // dependencies would tear the map down and rebuild it on every toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maptilerKey]);

  /* ---- grid vs dots vs heat ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // Both geometries ride in the same tile, so this is a visibility flip with
    // no refetch.
    map.setLayoutProperty(CELL_LAYER, "visibility", mode === "bins" ? "visible" : "none");
    map.setLayoutProperty(DOT_LAYER, "visibility", mode === "dots" ? "visible" : "none");
    map.setLayoutProperty(HEAT_LAYER, "visibility", mode === "heat" ? "visible" : "none");
  }, [mode, ready]);

  /* ---- how many, or what kind ---- */
  useEffect(() => {
    const map = mapRef.current;
    const scheme = schemeRef.current;
    if (!map || !ready || !scheme) return;
    // `weight`, `top_group` and `top_share` all ride in the same tile, so this
    // is a repaint rather than a refetch — the same reason the flip above is
    // free. The individual points are not touched: one report has no density to
    // express, so they are drawn by type in both settings.
    const byType = colour === "type";
    const density = densityStep(scheme);
    const group = groupColour(scheme);
    map.setPaintProperty(CELL_LAYER, "fill-color", byType ? group : density);
    map.setPaintProperty(
      DOT_LAYER,
      "circle-color",
      byType ? hollowCase(HOLLOW_GROUP, "transparent", group) : density,
    );
    map.setPaintProperty(
      DOT_LAYER,
      "circle-stroke-width",
      byType ? hollowCase(HOLLOW_GROUP, 2, 0.5) : 0.5,
    );
    map.setPaintProperty(
      DOT_LAYER,
      "circle-stroke-color",
      byType
        ? hollowCase(HOLLOW_GROUP, scheme.marks.sighting, scheme.halo)
        : scheme.halo,
    );
  }, [colour, ready]);

  /* ---- the selected record's ring ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const layer of [SELECT_HALO_LAYER, SELECT_RING_LAYER])
      map.setFilter(layer, ["==", ["get", "id"], selected ?? ""]);
  }, [selected, ready]);

  /* ---- filters: repoint the source, which re-keys the CDN cache too ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // Both sources point at the same endpoint and must be repointed together,
    // or the two zoom regimes show different filters. Only when the URL
    // actually changed: `setTiles` with an identical URL still throws away
    // every loaded tile and fetches them again.
    const url = tileUrl(filter);
    for (const id of [SOURCE_AGG, SOURCE_PTS]) {
      const src = map.getSource(id) as VectorTileSource | undefined;
      if (src && src.serialize().tiles?.[0] !== url) src.setTiles([url]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, filter.group, filter.taxonId, filter.from, filter.to]);

  /* ---- the legend, generated from what is actually drawn ---- */
  const points = zoom >= TILE_AGGREGATION_MAX_ZOOM + 1;
  const markShape: LegendSwatch["shape"] =
    mode === "bins" && !points ? "square" : "dot";
  const typeItems: LegendSwatch[] = [
    {
      color: "var(--mark-roadkill)",
      shape: markShape,
      label: t("report.group.roadkill"),
    },
    {
      color: "var(--mark-invasive)",
      shape: markShape,
      label: t("report.group.invasive"),
    },
    {
      color: "var(--mark-sighting)",
      shape: markShape === "square" ? "square" : "ring",
      label: t("report.group.sighting"),
    },
  ];
  const legendFor = (compact: boolean) => {
    if (points)
      return (
        <Legend
          mode="marks"
          compact={compact}
          caption={copy.map.legendPoints}
          items={typeItems}
        />
      );
    if (mode === "heat")
      return (
        <Legend
          mode="bar"
          compact={compact}
          caption={t("map.density")}
          lowLabel={copy.map.legendLow}
          highLabel={copy.map.legendHigh}
        />
      );
    if (colour === "type")
      return (
        <Legend
          mode="marks"
          compact={compact}
          caption={t("map.reportType")}
          items={[...typeItems, { color: "var(--map-mixed)", shape: markShape, label: t("map.mixed") }]}
        />
      );
    return (
      <Legend
        // The contiguous bar is only honest under the grid, whose marks are
        // squares. In dots mode the compact row is used at both sizes, because
        // it is the one that draws the swatch in the mark's own shape.
        compact={compact || mode === "dots"}
        caption={t("map.density")}
        items={DENSITY_CLASSES.map((c, i) => ({
          ramp: (i + 1) as LegendSwatch["ramp"],
          shape: markShape,
          // The break, not the range: six ranges at 14px do not fit a 320px
          // panel or a phone strip, and a scale is read by its breaks anyway.
          label: densityClassMax(i) === null ? `${c.min}+` : `${c.min}`,
        }))}
      />
    );
  };

  const detail = selected ?? cell;

  const controls = (
    <LabMapControls
      filter={filter}
      onFilter={setFilter}
      mode={mode}
      onMode={setMode}
      colour={colour}
      onColour={setColour}
      years={years}
      initialSpecies={initialSpecies}
      mapHref={mapHref}
      copy={copy}
      legend={legendFor(false)}
      // A flex child of the panel and of the sheet, both of which are columns
      // of a known height. `h-full` looked equivalent and was not: inside the
      // phone sheet it resolved against an auto height, the scroller never
      // scrolled, and the pinned legend fell out of the bottom of the sheet.
      className="min-h-0 flex-1"
    />
  );

  // The same block the record uses, in the same slot: a cell is the other thing
  // a click on this map can land on, and answering it somewhere else would make
  // the map feel like it had two different ideas about what a click means.
  const detailPosition =
    "absolute inset-x-0 bottom-8 z-20 max-h-[45dvh] md:inset-x-auto md:bottom-8 md:right-0 md:top-0 md:max-h-none md:w-100";

  const cellPanel = cell ? (
    <aside
      data-surface="field"
      aria-label={t("map.reportPanel")}
      className={`${detailPosition} overflow-y-auto bg-(--ground) p-6 text-(--fg)`}
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="t-head font-bold">
          {t("map.cellCount", { count: cell.count.toLocaleString() })}
        </h2>
        <button
          type="button"
          onClick={() => setCell(null)}
          aria-label={t("map.closePanel")}
          className="t-lead -mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center text-(--fg)"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <p className="t-body mt-4 text-(--fg-quiet)">
        {cell.metres >= 1000
          ? t("map.cellSize", { km: Math.round(cell.metres / 100) / 10 })
          : t("map.cellSizeM", { m: Math.round(cell.metres) })}
      </p>
      <Notice className="mt-6">{t("map.zoomHint")}</Notice>
    </aside>
  ) : null;

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* The docked panel. Collapsing it to a rail gives the map the width back
          without throwing away where you were, which is what closing a floating
          filter bar does. */}
      <div
        data-surface="field"
        className={`hidden shrink-0 flex-col bg-(--ground) text-(--fg) md:flex ${
          collapsed ? "w-14" : "w-80"
        }`}
      >
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? copy.map.expandPanel : copy.map.collapsePanel}
          className="t-lead flex h-14 w-full shrink-0 items-center justify-center text-(--fg)"
        >
          <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
        </button>
        {collapsed ? null : controls}
      </div>

      <div className="relative min-h-0 flex-1">
        {/*
          A skip link, before the map in DOM order. A WebGL canvas conveys
          nothing to assistive technology, and its whole purpose is to offer the
          equivalent table WITHOUT first traversing a canvas the reader cannot
          use. Every visual utility sits behind `focus:` — unqualified they
          fight `sr-only` and leave a phantom box in the layout.
        */}
        <Link
          href={{
            pathname: "/reports",
            query: Object.fromEntries(new URLSearchParams(filterToQuery(filter))),
          }}
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30 focus:bg-(--action) focus:px-4 focus:py-3 focus:text-(--action-fg) t-body"
        >
          {t("list.viewAsList")}
        </Link>

        {/*
          `relative h-full`, not `absolute inset-0`: maplibre-gl.css is unlayered
          and sets `.maplibregl-map { position: relative }`, which beats
          Tailwind's layered `.absolute`, so the element would stay relative and
          collapse to 0px. `data-surface="field"` makes MapLibre's own injected
          controls resolve the forest variables — they sit on the land.
        */}
        <div
          ref={container}
          data-surface="field"
          data-sheet={detail ? "record" : undefined}
          className="lab-map"
          role="application"
          aria-label={t("map.regionLabel")}
        />

        {/* Phone: the filters are a sign, because opening a sheet is an action. */}
        <div
          data-surface="field"
          className="absolute left-4 top-4 z-10 bg-(--ground) md:hidden"
        >
          <Button
            variant="secondary"
            onClick={() => setFiltersOpen(true)}
            aria-expanded={filtersOpen}
          >
            {copy.map.filters}
          </Button>
        </div>
        <div
          data-surface="field"
          className="absolute right-16 top-4 z-10 bg-(--ground) px-4 md:hidden"
        >
          <Filter
            legend={copy.common.nav}
            hideLegend
            value="map"
            options={[
              { value: "map", label: copy.map.tabMap, href: mapHref },
              {
                value: "list",
                label: copy.map.tabList,
                href: `/reports${filterToQuery(filter) ? `?${filterToQuery(filter)}` : ""}`,
              },
            ]}
          />
        </div>

        {/* Phone: a 32px legend strip, always on, above the attribution. It
            steps aside for a record, because the record someone asked to see
            outranks a key to colours they can read again once they close it. */}
        {detail ? null : (
          <div
            data-surface="field"
            className="absolute inset-x-0 bottom-0 z-10 flex h-8 items-center overflow-x-auto bg-(--ground) px-4 md:hidden"
          >
            {legendFor(true)}
          </div>
        )}

        {/* The record, or the cell. Right on a desktop, a sheet on a phone;
            clear of the attribution in both. */}
        {selected ? (
          <LabRecordPanel
            key={selected}
            id={selected}
            copy={copy}
            onClose={() => setSelected(null)}
            className={detailPosition}
          />
        ) : null}
        {cellPanel}

        {/* Phone: the filter sheet, capped so the map stays on screen behind it. */}
        {filtersOpen ? (
          <div
            data-surface="field"
            className="absolute inset-x-0 bottom-0 z-30 flex max-h-[60dvh] flex-col overflow-hidden bg-(--ground) text-(--fg) md:hidden"
          >
            <div className="flex shrink-0 items-center justify-between gap-4 px-6 pt-6">
              <h2 className="t-head font-bold">{copy.map.filters}</h2>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                aria-label={t("map.closePanel")}
                className="t-lead -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center text-(--fg)"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            {controls}
          </div>
        ) : null}
      </div>
    </div>
  );
}
