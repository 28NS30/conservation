import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

/**
 * A direction's basemap, as data the map can be handed.
 *
 * The whole bet of this directory is that a direction is a CSS file rather than
 * a rebuild, and a map is the place that bet is easiest to lose: a basemap is
 * paint, and paint wants to be written where the layers are. So the colours are
 * declared once in the theme files as `--map-*`, `--ramp-*` and `--mark-*`, and
 * read back off the DOM here. No component contains a colour, the lab test
 * enforces that, and swapping the theme repaints the map with everything else.
 *
 * Reading through `getComputedStyle` rather than importing a table has a second
 * benefit that is not about tidiness: the element being measured is inside
 * `[data-direction="…"]`, so the map cannot disagree with the page around it
 * about what "the island" is coloured.
 */
export type LabMapScheme = {
  /** The sea. Near-black under Roundel, so the island reads as a cut-out. */
  water: string;
  /** The island. The badge's ring colour: the map is the inside of the emblem. */
  land: string;
  road: string;
  /** Place labels, and their halo. */
  label: string;
  halo: string;
  /** A line where land meets water, or `transparent` for none. */
  coast: string;
  selectRing: string;
  selectHalo: string;
  /** A cell that is not mostly any one type. Grey is a real answer, not a gap. */
  mixed: string;
  /** Six density classes, lightness-monotonic, lowest at 3:1 on this land. */
  ramp: readonly [string, string, string, string, string, string];
  /** Type marks. Form carries the meaning; these only tint it. */
  marks: {
    roadkill: string;
    injured: string;
    invasive: string;
    sighting: string;
  };
};

/**
 * Read the scheme off an element inside the themed subtree.
 *
 * Answers null when the element is not under a direction — in which case the
 * caller must leave the basemap alone rather than repaint it in empty strings,
 * which MapLibre rejects layer by layer with a console warning per layer and a
 * map that renders as a black rectangle.
 */
export function readMapScheme(element: Element): LabMapScheme | null {
  const styles = getComputedStyle(element);
  const read = (name: string, fallback = ""): string =>
    styles.getPropertyValue(name).trim() || fallback;

  const land = read("--map-land");
  if (!land) return null;

  const water = read("--map-water", land);
  const label = read("--map-label", land);
  const ramp = [1, 2, 3, 4, 5, 6].map((n) => read(`--ramp-${n}`, label)) as
    unknown as LabMapScheme["ramp"];

  return {
    land,
    water,
    road: read("--map-road", land),
    label,
    halo: read("--map-halo", water),
    coast: read("--map-coast", "transparent"),
    selectRing: read("--map-select-ring", label),
    selectHalo: read("--map-select-halo", water),
    // Reusing the lowest density step is deliberate. A mixed cell has to be
    // visible on land and distinguishable from all three type marks, and the
    // one colour in the theme already proved to clear 3:1 against this land is
    // ramp 1 — which also sits at least 1.68:1 from every mark.
    mixed: read("--map-mixed", read("--ramp-1", label)),
    ramp,
    marks: {
      roadkill: read("--mark-roadkill", ramp[0]),
      injured: read("--mark-injured", read("--mark-roadkill", ramp[0])),
      invasive: read("--mark-invasive", ramp[5]),
      sighting: read("--mark-sighting", ramp[3]),
    },
  };
}

/**
 * The same colour at a given opacity, as `rgba(…)`.
 *
 * Only the heatmap needs it: `heatmap-color` is a gradient over density and has
 * to start fully transparent, and MapLibre interpolates the alpha channel along
 * with the other three. Accepts whatever `getComputedStyle` hands back for a
 * custom property, which is the value as authored — so `#rrggbb` in practice,
 * with the `rgb()` form covered in case a theme ever writes one.
 */
export function withAlpha(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : hex[1];
    const channel = (i: number) => parseInt(digits.slice(i, i + 2), 16);
    return `rgba(${channel(0)},${channel(2)},${channel(4)},${alpha})`;
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(colour);
  if (rgb) {
    const [r, g, b] = rgb[1].split(/[\s,/]+/).filter(Boolean);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  // A keyword such as `transparent`, which has no alpha to give.
  return colour;
}

/** Vector source-layers that are the sea, whatever the style calls its layers. */
const WATER_SOURCE_LAYERS = new Set(["water", "waterway", "water_name"]);

/**
 * Repaint a basemap style into a direction's scheme.
 *
 * Runs on the style JSON before `new Map`, in the same pass that already
 * rewrites the labels (`transformBasemap`), so there is no restyle after the
 * first frame and no extra request: the style URL, the tile endpoints and the
 * preload are exactly the live map's.
 *
 * Matched on `type` and `source-layer` rather than on layer ids. OpenFreeMap's
 * dark style has forty-seven layers with ids like `highway_major_casing` and
 * `landcover_ice_shelf`, and an upstream restyle that renames or adds one must
 * not leave a stripe of the old palette across the island. Anything that is not
 * water, a label or a line is land: the island is meant to read as one solid
 * block of the badge's ring colour, so landuse, parks, buildings and piers all
 * disappear into it on purpose.
 */
export function repaintBasemap(
  style: StyleSpecification,
  scheme: LabMapScheme,
): StyleSpecification {
  const layers = style.layers.map((layer): LayerSpecification => {
    if (layer.type === "background") {
      return {
        ...layer,
        paint: { ...layer.paint, "background-color": scheme.land },
      };
    }

    const source = layer["source-layer"];

    if (layer.type === "fill") {
      const isWater = source === "water";
      const fill = isWater ? scheme.water : scheme.land;
      return {
        ...layer,
        paint: {
          ...layer.paint,
          "fill-color": fill,
          // A coast is the one line the scheme may ask for, and it is the water
          // polygon's own outline — there is no coastline layer in these tiles,
          // and a hand-drawn ocean polygon shows seams at tile edges.
          "fill-outline-color":
            isWater && scheme.coast !== "transparent" ? scheme.coast : fill,
        },
      };
    }

    if (layer.type === "line") {
      return {
        ...layer,
        paint: {
          ...layer.paint,
          "line-color":
            source && WATER_SOURCE_LAYERS.has(source)
              ? scheme.water
              : scheme.road,
        },
      };
    }

    // Labels only. A symbol layer with no text-field is a road shield or a
    // one-way arrow, and giving it a text colour changes nothing but noise.
    if (layer.type === "symbol" && layer.layout?.["text-field"] !== undefined) {
      return {
        ...layer,
        paint: {
          ...layer.paint,
          "text-color": scheme.label,
          "text-halo-color": scheme.halo,
          // Enough to keep a place name legible over six density classes. The
          // stock style haloes for a near-black ground it no longer has.
          "text-halo-width": 1.4,
        },
      };
    }

    return layer;
  });

  return { ...style, layers };
}

/**
 * Where the report layers go: under the place names, over everything else.
 *
 * Labels are the one part of a basemap that has to survive the data drawn on
 * top of it — a map whose densest areas are also the ones whose town names are
 * buried is a map you cannot say anything about. Roads and boundaries stay
 * underneath, which is the right order anyway: the road corridors are the shape
 * the data is describing, not a competing layer.
 */
export function firstPlaceLabelId(style: StyleSpecification): string | undefined {
  return style.layers.find(
    (layer) => layer.type === "symbol" && layer["source-layer"] === "place",
  )?.id;
}
