import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Report categories
 * ------------------------------------------------------------------ */

/**
 * Report categories.
 *
 * Domain data only — no display text. Labels live in apps/web/messages/*.json
 * keyed by these same names, so adding a locale never means touching this file.
 */
export const CATEGORIES = {
  /** `classifiable`: whether a photo of this category is sent to the species classifier. */
  roadkill: { classifiable: true, color: "#e11d48" },
  invasive: { classifiable: true, color: "#f59e0b" },
  injured: { classifiable: true, color: "#fb923c" },
  sighting: { classifiable: true, color: "#10b981" },
  pollution: { classifiable: false, color: "#6366f1" },
  habitat: { classifiable: false, color: "#a855f7" },
} as const;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];
export const CLASSIFIABLE_CATEGORIES = CATEGORY_KEYS.filter(
  (c) => CATEGORIES[c].classifiable,
);

/* ------------------------------------------------------------------ *
 * Geography
 * ------------------------------------------------------------------ */

/**
 * Bounds covering Taiwan *including* the outlying islands. Kinmen and Matsu sit
 * far west near Fujian (down to ~118.1E, up to ~26.4N), well outside the main
 * island's envelope — a map clipped to the main island alone cuts them off.
 */
export const TAIWAN_BOUNDS: [[number, number], [number, number]] = [
  [118.0, 21.5],
  [122.5, 26.5],
];

/** Main island centre, a sensible default view. */
export const TAIWAN_CENTER: [number, number] = [120.98, 23.7];

export function isInTaiwanBounds(lng: number, lat: number): boolean {
  const [[w, s], [e, n]] = TAIWAN_BOUNDS;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

/* ------------------------------------------------------------------ *
 * Location disclosure
 * ------------------------------------------------------------------ */

/**
 * Mirrors reports.location_precision. Driven by TaiCOL's per-taxon sensitivity
 * rating (敏感度); see sensitivity_cell_deg() in 0001_init.sql.
 */
export const LOCATION_PRECISION = {
  exact: { approxKm: 0 },
  coarse_10km: { approxKm: 10 },
  coarse_50km: { approxKm: 50 },
  suppressed: { approxKm: Infinity },
} as const;

export type LocationPrecision = keyof typeof LOCATION_PRECISION;

/* ------------------------------------------------------------------ *
 * Map filters — the shape shared by the UI and the tile endpoint
 * ------------------------------------------------------------------ */

export const mapFilterSchema = z.object({
  category: z.enum(CATEGORY_KEYS as [Category, ...Category[]]).optional(),
  taxonId: z.coerce.number().int().positive().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export type MapFilter = z.infer<typeof mapFilterSchema>;

/** Serialise filters into a query string. This doubles as the CDN cache key. */
export function filterToQuery(f: MapFilter): string {
  const p = new URLSearchParams();
  if (f.category) p.set("category", f.category);
  if (f.taxonId) p.set("taxonId", String(f.taxonId));
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p.toString();
}

/* ------------------------------------------------------------------ *
 * Report submission
 * ------------------------------------------------------------------ */

export const MAX_PHOTOS = 4;
export const MAX_NOTES = 1000;
/** Post-downscale ceiling. Phone originals are 3–8 MB; we send ~250 KB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;

/** Longest edge after client-side downscale, before upload. */
export const IMAGE_MAX_EDGE = 2048;
export const IMAGE_WEBP_QUALITY = 0.82;

export const reportSubmissionSchema = z
  .object({
    category: z.enum(CATEGORY_KEYS as [Category, ...Category[]]),
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    observedAt: z.iso.datetime(),
    notes: z.string().trim().max(MAX_NOTES).optional(),
    /** Optional, so we can follow up on an interesting record. Never displayed. */
    contactEmail: z.email().optional(),
    /** Storage paths returned by /api/uploads/sign, already uploaded by the client. */
    photoPaths: z.array(z.string().min(1)).max(MAX_PHOTOS).default([]),
    /** Client-generated, so a double-tap or offline retry cannot duplicate a report. */
    clientNonce: z.uuid(),
    turnstileToken: z.string().min(1).optional(),
  })
  .refine((r) => new Date(r.observedAt) <= new Date(Date.now() + 5 * 60_000), {
    message: "observedAt cannot be in the future",
    path: ["observedAt"],
  })
  .refine((r) => new Date(r.observedAt) >= new Date("1990-01-01"), {
    message: "observedAt is implausibly old",
    path: ["observedAt"],
  });

export type ReportSubmission = z.infer<typeof reportSubmissionSchema>;

/**
 * Whether a submission should be held back from the public map until the
 * classifier has run.
 *
 * A classifiable report has no taxon at submission time, so its sensitivity is
 * unknown — publishing immediately would expose a protected species' exact
 * coordinate until classification caught up. See 0003_reporting.sql.
 */
export function requiresClassification(category: Category, photoCount: number): boolean {
  return CATEGORIES[category].classifiable && photoCount > 0;
}

/**
 * Precision applied to a report whose species is not yet known. Deliberately
 * conservative: it is the same protection a 輕度-rated taxon receives, and the
 * trigger will tighten it further if classification reveals something rarer.
 */
export const UNIDENTIFIED_PRECISION: LocationPrecision = "coarse_10km";

/* ------------------------------------------------------------------ *
 * Tile strategy
 * ------------------------------------------------------------------ */

/**
 * At or below this zoom the tile endpoint returns grid-aggregated cells carrying
 * a `weight`; above it, individual points. Shipping ~50k raw points at country
 * zoom is what makes naive density maps collapse.
 *
 * Set to 10 rather than 9 because aggregation is still earning its keep there:
 * measured on the densest z10 tile, 4,984 reports collapse to 2,067 cells. Handing
 * over to raw points at z10 dumped all 4,984 into a 512px tile — roughly 7px
 * apart, which with a 2.5px radius renders as one solid mass rather than points
 * you can pick out. One more level of aggregation puts the switch where the
 * points are actually separable.
 */
export const TILE_AGGREGATION_MAX_ZOOM = 13;

/**
 * Class breaks for the binned density map.
 *
 * The map draws aggregation cells as discrete filled squares, not as a heatmap.
 * That was a deliberate replacement: MapLibre's `heatmap` layer is a kernel
 * density estimate — every point becomes a Gaussian blob and the blobs are
 * summed — so blur is inherent to the layer type, not a setting. No combination
 * of radius and weight makes it sharp.
 *
 * Discrete classes also end a maintenance problem. A continuous kernel sum has
 * to be re-fitted whenever the dataset grows, because the density at a pixel
 * depends on how many neighbouring kernels overlap it. An absolute per-cell
 * count does not: "this cell holds 30–99 reports" means the same thing at 46k
 * records as at 460k.
 *
 * Breaks are round numbers on a roughly logarithmic scale, chosen against the
 * measured distribution (median cell 3 reports, p90 20, p99 129, max 1,321) so
 * every class is populated and the legend is readable by a non-specialist.
 *
 * Both the paint expression and the legend are generated from this one array, so
 * they cannot drift apart.
 */
export const DENSITY_CLASSES = [
  // The lowest class is deliberately dark and low-contrast. Most cells in the
  // country hold one or two reports, so a bright colour here turns the map into
  // blue noise and buries the structure — compared side by side, dimming this
  // one class is what lets the road corridors and the empty mountain spine read.
  { min: 1, color: "#1e3a5f" },
  { min: 3, color: "#1d4ed8" },
  { min: 10, color: "#0891b2" },
  { min: 30, color: "#10b981" },
  { min: 100, color: "#f59e0b" },
  { min: 300, color: "#dc2626" },
] as const;

/**
 * Breaks for a single-species map.
 *
 * A species map needs its own scale. Even the most-reported species holds a few
 * thousand records against the corpus's 46k, so most of its cells contain one or
 * two — run through DENSITY_CLASSES nearly every cell would fall into the lowest,
 * deliberately-dim class and the map would read as empty. These breaks are
 * compressed accordingly, and the lowest class is bright rather than dim, because
 * here a single record is a signal rather than background.
 */
export const SPECIES_DENSITY_CLASSES = [
  { min: 1, color: "#1d4ed8" },
  { min: 2, color: "#0891b2" },
  { min: 5, color: "#10b981" },
  { min: 15, color: "#eab308" },
  { min: 40, color: "#f97316" },
] as const;

/** Inclusive upper bound of a class, or null for the open-ended top class. */
export function densityClassMax(
  i: number,
  classes: readonly { min: number }[] = DENSITY_CLASSES,
): number | null {
  const next = classes[i + 1];
  return next ? next.min - 1 : null;
}

/** Build a MapLibre `step` expression from a class array. */
export function densityStepExpression(
  classes: readonly { min: number; color: string }[],
): unknown[] {
  return [
    "step",
    ["coalesce", ["get", "weight"], 1],
    classes[0].color,
    ...classes.slice(1).flatMap((c) => [c.min, c.color]),
  ];
}

/**
 * Grid cell size in Web Mercator metres for aggregated tiles.
 *
 * 128 cells across a tile. Since MapLibre renders vector tiles at 512 CSS px,
 * this is the one number that decides how big a cell looks on screen — 512/128 =
 * **4 px, at every zoom**, because the cell size scales with the zoom level.
 *
 * That figure is chosen for legibility, not for blending. The previous value of
 * 256 dates from when these cells were fed through a heatmap kernel, where small
 * cells were desirable because they had to melt into each other. Drawn as
 * discrete squares they must instead be individually visible, and 2 px is at the
 * limit of what reads as a shape; compared side by side, 4 px is legible and 2 px
 * is noise.
 *
 * Still a large reduction: a z6 tile over Taiwan carries ~1,600 cells rather than
 * ~46,000 raw points.
 */
export const AGGREGATION_CELLS_PER_TILE = 128;

export function aggregationCellMeters(zoom: number): number {
  // Web Mercator world is ~40,075,016m across; a tile at zoom z spans
  // 40075016 / 2^z metres.
  return 40075016.686 / Math.pow(2, zoom) / AGGREGATION_CELLS_PER_TILE;
}
