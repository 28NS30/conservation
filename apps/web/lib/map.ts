import type { Map as MLMap, StyleSpecification } from "maplibre-gl";
import { TAIWAN_BOUNDS, TAIWAN_CENTER } from "@conservation/shared";

/**
 * MapLibre is loaded as a raw ES module from public/maplibre, NOT through the
 * bundler. This is not a style preference — it is required.
 *
 * Turbopack's bundled build of maplibre-gl produces a broken Web Worker: the
 * worker is constructed and immediately closed, and the failure is completely
 * silent. No console error, no failed request, no rejected promise —
 * `isSourceLoaded()` simply stays false forever. Because raster tiles decode on
 * the main thread, the basemap keeps rendering perfectly while every vector and
 * GeoJSON layer stays invisible, which reads exactly like a data or styling bug.
 *
 * Demonstrated by running both builds side by side on the same page against the
 * same endpoint: the raw ESM build returned 471 features, the bundled build 0.
 *
 * `npm run sync:maplibre` copies the dist files into public/ and runs
 * automatically before dev and build, so they cannot drift from package.json.
 */
export type MapLibre = typeof import("maplibre-gl");

const MAPLIBRE_URL = "/maplibre/maplibre-gl.mjs";
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

let modulePromise: Promise<MapLibre> | null = null;

export function loadMapLibre(): Promise<MapLibre> {
  if (!modulePromise) {
    modulePromise = (
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ MAPLIBRE_URL) as Promise<MapLibre>
    ).then((ml) => {
      ml.setWorkerUrl(WORKER_URL);
      return ml;
    });
  }
  return modulePromise;
}

/**
 * Keyless dark basemap. CARTO permits use with attribution and reads far better
 * under a heatmap than a standard OSM raster. Set NEXT_PUBLIC_MAPTILER_KEY to
 * swap in vector tiles with zh-Hant labels.
 */
export function basemapStyle(maptilerKey?: string): StyleSpecification | string {
  if (maptilerKey) {
    return `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${maptilerKey}`;
  }
  return {
    version: 8,
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      carto: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
          "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
          "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        ],
        tileSize: 256,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      },
    },
    layers: [{ id: "carto", type: "raster", source: "carto" }],
  };
}

/** Padded so Kinmen and Matsu, far west near Fujian, stay reachable. */
export const PADDED_TAIWAN_BOUNDS: [[number, number], [number, number]] = [
  [TAIWAN_BOUNDS[0][0] - 1.5, TAIWAN_BOUNDS[0][1] - 1.5],
  [TAIWAN_BOUNDS[1][0] + 1.5, TAIWAN_BOUNDS[1][1] + 1.5],
];

export type MapHandle = {
  map: MLMap;
  /** The runtime module, so callers can construct Popup/Marker/etc. */
  ml: MapLibre;
  destroy: () => void;
};

/**
 * Create a MapLibre map with the workarounds this project needs everywhere, so
 * they are fixed once rather than rediscovered per component.
 *
 *  1. The container must be sized with `h-full`, never `absolute inset-0`:
 *     maplibre-gl.css is unlayered and sets `.maplibregl-map { position: relative }`,
 *     which beats Tailwind 4's layered `.absolute` utility, collapsing it to 0px.
 *  2. MapLibre sizes itself once at construction and only watches *window*
 *     resizes, so in a flex layout it sticks at its 400x300 fallback.
 */
export async function createMap(
  container: HTMLElement,
  opts: {
    maptilerKey?: string;
    center?: [number, number];
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
    navigation?: boolean;
    bounded?: boolean;
    /** Runs once the style is ready for addSource/addLayer. Must be idempotent. */
    onReady?: (map: MLMap) => void;
  } = {},
): Promise<MapHandle> {
  const ml = await loadMapLibre();

  const map = new ml.Map({
    container,
    style: basemapStyle(opts.maptilerKey),
    center: opts.center ?? TAIWAN_CENTER,
    zoom: opts.zoom ?? 6.6,
    ...(opts.bounded === false ? {} : { maxBounds: PADDED_TAIWAN_BOUNDS }),
    minZoom: opts.minZoom ?? 5,
    maxZoom: opts.maxZoom ?? 18,
    attributionControl: { compact: true },
  });

  map.on("error", (e) => {
    console.error("[maplibre]", (e as unknown as { error?: Error }).error ?? e);
  });

  if (opts.navigation !== false) {
    map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
  }

  let disposed = false;
  let done = false;
  const fire = () => {
    if (disposed || done || !map.isStyleLoaded()) return;
    done = true;
    opts.onReady?.(map);
  };
  map.on("load", fire);
  map.on("style.load", fire);
  fire();

  const ro = new ResizeObserver(() => map.resize());
  ro.observe(container);

  return {
    map,
    ml,
    destroy: () => {
      disposed = true;
      ro.disconnect();
      map.remove();
    },
  };
}
