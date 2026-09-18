import type { ExpressionSpecification } from "maplibre-gl";
import { TILE_AGGREGATION_MAX_ZOOM } from "@conservation/shared";
import type { MapColour, MapMode } from "./mapMode";

/**
 * What the map is actually drawing, so the legend can say so.
 *
 * The legend used to be a function of the colour switch alone, and the map is
 * not. Two of its states were therefore simply untrue:
 *
 *  - Past the aggregation handoff the map stops drawing cells and draws one
 *    circle per record, coloured by category whatever the colour switch says.
 *    The legend went on offering six density classes, so every single-record dot
 *    on a roadkill corridor was labelled "300+".
 *  - The heat surface is a kernel density estimate. The colour at a pixel is a
 *    sum over neighbouring blobs and equals no feature's count, so per-cell
 *    numbers beside it name quantities that are not on screen — and the ramp is
 *    fixed, so the colour switch has no effect on it at all.
 *
 * Kept as a pure module with no runtime import but the one constant it derives
 * the handoff zoom from, so `node --test` can import it directly and a later
 * workstream can reuse it without dragging MapLibre or React along. Everything
 * here is data in, data out.
 */

/** The first zoom at which the map paints individual records rather than cells. */
export const POINTS_FROM_ZOOM = TILE_AGGREGATION_MAX_ZOOM + 1;

export type LegendKind = "points" | "heat" | "type" | "density";

export type Legend = {
  /** Also written to `data-legend`, which is what the end-to-end spec reads. */
  kind: LegendKind;
  /**
   * What the colour on screen MEANS right now, which is not always the stored
   * preference: individual records are always by category, the heat ramp is
   * always by density.
   */
  colour: MapColour;
  /** True when the other colour option cannot apply to what is being drawn. */
  locked: boolean;
  /** Message key saying why, for the reader, or null when nothing is locked. */
  reason: "map.colourLockedPoints" | "map.colourLockedHeat" | null;
};

/**
 * Which legend belongs to (mode, colour, zoom). First match wins.
 *
 * Zoom outranks mode and mode outranks colour, because that is the order in
 * which the map overrides the reader's choices: above the handoff no mode draws
 * anything but records, and in heat mode no colour setting reaches the ramp.
 */
export function legendFor({
  mode,
  colour,
  zoom,
}: {
  mode: MapMode;
  colour: MapColour;
  zoom: number;
}): Legend {
  if (zoom >= POINTS_FROM_ZOOM)
    return {
      kind: "points",
      colour: "type",
      locked: true,
      reason: "map.colourLockedPoints",
    };
  if (mode === "heat")
    return {
      kind: "heat",
      colour: "density",
      locked: true,
      reason: "map.colourLockedHeat",
    };
  if (colour === "type")
    return { kind: "type", colour: "type", locked: false, reason: null };
  return { kind: "density", colour: "density", locked: false, reason: null };
}

/**
 * The heat surface's colour ramp: [heatmap-density, colour].
 *
 * One array, feeding both the paint expression and the legend's gradient bar.
 * They were separate — the paint had these stops written out inline and the
 * legend had no bar at all — and the first thing anyone drawing a bar by hand
 * would have done is approximate them. Same blue → cyan → green → amber → red
 * progression as DENSITY_CLASSES, so switching modes does not mean relearning
 * the colours.
 */
export const HEAT_STOPS: readonly (readonly [density: number, color: string])[] =
  [
    [0, "rgba(0,0,0,0)"],
    [0.15, "rgba(56,132,255,0.55)"],
    [0.35, "rgba(34,211,238,0.7)"],
    [0.55, "rgba(52,211,153,0.8)"],
    [0.75, "rgba(251,146,60,0.88)"],
    [1, "rgba(244,63,94,0.95)"],
  ];

/** The `heatmap-color` paint property, built from HEAT_STOPS. */
export function heatColorExpression(): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    ...HEAT_STOPS.flatMap(([at, color]) => [at, color]),
  ] as unknown as ExpressionSpecification;
}

/**
 * The same ramp as a CSS gradient, for the legend bar.
 *
 * An inline style rather than a Tailwind class on purpose: a colour class naming
 * a token the palette does not define emits no CSS at all, silently, and these
 * colours belong to the map rather than to the palette. The swatches beside it
 * are drawn the same way.
 */
export function heatGradientCss(): string {
  return `linear-gradient(to right, ${HEAT_STOPS.map(
    ([at, color]) => `${color} ${Math.round(at * 100)}%`,
  ).join(", ")})`;
}
