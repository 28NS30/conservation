import type { Map as MLMap, StyleSpecification } from "maplibre-gl";
import { TAIWAN_BOUNDS, TAIWAN_CENTER } from "@conservation/shared";
import { withBase } from "@/lib/basePath";
import {
  FALLBACK_STYLE,
  OPENFREEMAP_DARK,
  transformBasemap,
} from "@/lib/basemap";

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

const MAPLIBRE_URL = withBase("/maplibre/maplibre-gl.mjs");
const WORKER_URL = withBase("/maplibre/maplibre-gl-worker.mjs");

let modulePromise: Promise<MapLibre> | null = null;

export function loadMapLibre(): Promise<MapLibre> {
  if (!modulePromise) {
    modulePromise = (
      import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ MAPLIBRE_URL
      ) as Promise<MapLibre>
    ).then((ml) => {
      ml.setWorkerUrl(WORKER_URL);
      return ml;
    });
  }
  return modulePromise;
}

/**
 * Fetch the basemap style and adapt it, or fall back to a plain background.
 *
 * Fetched here rather than handed to MapLibre as a URL for two reasons. The
 * labels have to be rewritten before the first frame (see transformBasemap), and
 * a failure has to degrade to FALLBACK_STYLE rather than leave the map with no
 * style at all, in which case `load` never fires and none of the site's own
 * layers draw.
 *
 * The MapTiler branch is kept only so an existing key keeps working. Do not set
 * one: MapTiler's free plan is limited to undefined "non-commercial use", pauses
 * the service when its quota runs out, and requires a logo this site does not
 * render. See docs/launch-checklist.md.
 */
async function loadBasemap(
  maptilerKey: string | undefined,
  locale: string,
): Promise<StyleSpecification> {
  const url = maptilerKey
    ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${maptilerKey}`
    : OPENFREEMAP_DARK;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return transformBasemap((await res.json()) as StyleSpecification, locale);
  } catch (err) {
    // A handled degradation, not an error: the data still draws.
    console.warn(
      "[basemap] style unavailable, drawing on a plain background",
      err,
    );
    return FALLBACK_STYLE;
  }
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
 *  1. The container must be sized AND positioned: `relative h-full`. MapLibre 6
 *     does not add a `.maplibregl-map` class to the element it is handed, so the
 *     stock `.maplibregl-map { position: relative }` rule matches nothing at all.
 *     The canvas it inserts is `position: absolute`, so a static container lets
 *     it escape to the nearest positioned ancestor — or the viewport, where it
 *     paints over the page header.
 *  2. MapLibre sizes itself once at construction and only watches *window*
 *     resizes, so in a flex layout it sticks at its 400x300 fallback.
 */
export async function createMap(
  container: HTMLElement,
  opts: {
    maptilerKey?: string;
    /** Label language. Defaults to the page's own <html lang>. */
    locale?: string;
    center?: [number, number];
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
    navigation?: boolean;
    bounded?: boolean;
    /**
     * Display-only: no panning, no zooming, no keyboard focus.
     *
     * For the home page hero, where the map is a live illustration rather than an
     * instrument. Leaving it interactive there would hijack the page scroll the
     * moment a reader's cursor crossed it, which is the single most irritating
     * thing a full-bleed map can do.
     */
    static?: boolean;
    /**
     * Runs exactly once, at `style.load`: the style has been applied and
     * addSource/addLayer are legal, but basemap tiles may still be arriving.
     */
    onReady?: (map: MLMap) => void;
  } = {},
): Promise<MapHandle> {
  // Every page sets <html lang>, so reading it here spares the four components
  // that create maps from threading a locale through.
  const locale = opts.locale ?? (document.documentElement.lang || "zh-TW");
  const [ml, style] = await Promise.all([
    loadMapLibre(),
    loadBasemap(opts.maptilerKey, locale),
  ]);

  const map = new ml.Map({
    container,
    style,
    center: opts.center ?? TAIWAN_CENTER,
    zoom: opts.zoom ?? 6.6,
    // maxBounds keeps a browsing user from panning off to the Atlantic. It is
    // actively harmful on a static hero: when the viewport is wider than the
    // bounds — which it is at country zoom on a desktop — MapLibre silently
    // overrides the requested centre to make the bounds fit, so the deliberate
    // framing is thrown away. Nothing can pan a static map anyway.
    ...(opts.bounded === false || opts.static
      ? {}
      : { maxBounds: PADDED_TAIWAN_BOUNDS }),
    minZoom: opts.minZoom ?? 5,
    maxZoom: opts.maxZoom ?? 18,
    attributionControl: { compact: true },
    ...(opts.static
      ? {
          interactive: false,
          // Belt and braces: `interactive:false` covers the handlers, but the
          // canvas would still take tab focus and announce itself as an
          // application to a screen reader.
          attributionControl: { compact: true },
        }
      : {}),
  });

  map.on("error", (e) => {
    console.error("[maplibre]", (e as unknown as { error?: Error }).error ?? e);
  });

  // OpenFreeMap's dark style names two images its own sprite does not contain,
  // circle-11 (the city dot) and wood-pattern, and MapLibre warns about each on
  // every tile that uses them. A transparent pixel draws exactly what was drawn
  // before, nothing, without the noise, and covers any gap a future style update
  // opens. It has to be a resolver: MapLibre 6 runs the resolver first, then
  // fires `styleimagemissing` and logs the warning regardless of what a listener
  // does, so a listener alone silences nothing.
  map.setMissingStyleImageResolver((id) => {
    if (!map.hasImage(id)) {
      map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
    }
  });

  if (opts.navigation !== false && !opts.static) {
    map.addControl(
      new ml.NavigationControl({ showCompass: false }),
      "top-right",
    );
  }

  // onReady fires once, at `style.load` — when the style JSON has been applied
  // and sources and layers may be added — and NOT when the style has finished
  // loading.
  //
  // It used to wait on `isStyleLoaded()`, which in MapLibre 6 stays false until
  // every basemap tile in view has arrived, the sprite has loaded and the first
  // frame has drawn. So our report sources were only added after OpenFreeMap
  // had delivered everything, and the dots queued behind the whole basemap.
  // Measured on production, style.load to first dot: desktop 1036 → 237 ms,
  // phone at 4x CPU 1298 → 396 ms, slow 4G first dot 7.3 → 5.3 s. Our sources
  // use inline `tiles`, so they have no TileJSON of their own to wait for.
  //
  // No synchronous call is needed and none is safe: Style.loadJSON defers to the
  // next animation frame, so this listener is always registered before the
  // event can fire.
  let disposed = false;
  let done = false;
  const fire = () => {
    if (disposed || done) return;
    done = true;
    opts.onReady?.(map);
  };
  map.once("style.load", fire);

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
