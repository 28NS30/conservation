import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

/**
 * The basemap, and what has to be done to it before MapLibre sees it.
 *
 * Kept free of runtime imports so `node --test` can import it directly. It is
 * pure data in, data out, and the rules in it are exactly the kind that break
 * silently: a label field that reads Simplified Chinese renders perfectly well.
 *
 * WHY OPENFREEMAP. Until September 2026 the keyless basemap was CARTO's dark_all
 * raster, until CARTO began stamping "API KEY REQUIRED" across every tile served
 * without one. OpenFreeMap is the keyless option whose terms plainly allow a
 * public site ("Is commercial usage allowed? Yes."), and its tiles carry
 * Traditional Chinese names, which CARTO's romanised raster never could. It has
 * no SLA and runs on donations, the same shape of risk that just broke CARTO,
 * which is why a failed style degrades to FALLBACK_STYLE rather than taking the
 * site's own data down with it.
 */
export const OPENFREEMAP_DARK = "https://tiles.openfreemap.org/styles/dark";

/**
 * What the map draws when no basemap can be loaded.
 *
 * A real style rather than an error. MapLibre only fires `load` once a style is
 * ready, and every map on the site adds its own layers from there, so a basemap
 * outage would otherwise blank the heatmap along with the land.
 */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0c0c0c" },
    },
  ],
};

/**
 * Traditional first. The tiles also carry name:zh-Hans, holding Simplified forms
 * such as 台北市, and it must never be read. name:zh-Hant is sparse in Taiwan, so
 * the chain relies on name:zh and name there, which OSM contributors write in
 * Traditional by convention.
 */
export const NAME_ZH: ExpressionSpecification = [
  "coalesce",
  ["get", "name:zh-Hant"],
  ["get", "name:zh"],
  ["get", "name"],
];

export const NAME_EN: ExpressionSpecification = [
  "coalesce",
  ["get", "name:en"],
  ["get", "name_en"],
  ["get", "name"],
];

/**
 * The stock labels are rgb(101,101,101) on near-black, and water names are black
 * text: legible on an empty map, lost under a heatmap. Roads stay a step dimmer
 * than places so the hierarchy survives.
 */
const PLACE_LABEL = "#9a9a9a";
const ROAD_LABEL = "#7a7a7a";
const LABEL_HALO = "rgba(0,0,0,0.85)";

/**
 * Land boundaries only. The stock style also draws maritime ones: territorial-sea
 * and EEZ lines, which loop around every Ryukyu islet and run a line down the
 * Taiwan Strait. CARTO never drew them, they mean nothing on a wildlife map, and
 * a line in the Strait is a statement this site has no reason to make.
 *
 * A legacy filter ("==", "admin_level", 2) cannot be combined with an expression,
 * so the added clause matches whichever form the layer already uses.
 */
function landBoundariesOnly(
  filter: FilterSpecification | undefined,
): FilterSpecification {
  const notMaritime: ExpressionSpecification = ["!=", ["get", "maritime"], 1];
  if (!filter) return notMaritime;
  const legacy = !JSON.stringify(filter).includes('["get"');
  return (
    legacy
      ? ["all", filter, ["!=", "maritime", 1]]
      : ["all", filter, notMaritime]
  ) as FilterSpecification;
}

/** Does this text-field show a feature's name, rather than a road number? */
function showsName(textField: unknown): boolean {
  return /name/.test(JSON.stringify(textField ?? null));
}

/**
 * Rewrite the style's labels for the page's language, and drop sea boundaries.
 *
 * The stock style prints the Latin name over the local one, uppercased, and never
 * reads name:zh or name:zh-Hant — so a Taiwanese reader got "TAIPEI" above 臺北市.
 * Layers are matched by what their text-field reads, never by id, so an upstream
 * restyle that renames a layer cannot quietly undo this. Road-number layers do
 * not read a name and are left alone.
 */
export function transformBasemap(
  style: StyleSpecification,
  locale: string,
): StyleSpecification {
  const zh = locale.toLowerCase().startsWith("zh");
  const layers = style.layers.map((layer): LayerSpecification => {
    if (layer.type === "line" && layer["source-layer"] === "boundary") {
      return { ...layer, filter: landBoundariesOnly(layer.filter) };
    }
    if (layer.type !== "symbol" || !showsName(layer.layout?.["text-field"])) {
      return layer;
    }
    const layout = {
      ...layer.layout,
      "text-field": zh ? NAME_ZH : NAME_EN,
    };
    // Uppercasing does nothing to Hanzi and only shouts the Latin fallback.
    if (zh) delete layout["text-transform"];
    const road = layer["source-layer"] === "transportation_name";
    return {
      ...layer,
      layout,
      paint: {
        ...layer.paint,
        "text-color": road ? ROAD_LABEL : PLACE_LABEL,
        "text-halo-color": LABEL_HALO,
      },
    };
  });
  return { ...style, layers };
}
