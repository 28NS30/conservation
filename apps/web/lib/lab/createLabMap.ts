import type { Map as MLMap, StyleSpecification } from "maplibre-gl";
import { TAIWAN_CENTER } from "@conservation/shared";
import {
  FALLBACK_STYLE,
  OPENFREEMAP_DARK,
  transformBasemap,
} from "@/lib/basemap";
import { loadMapLibre, type MapLibre } from "@/lib/map";
import { repaintBasemap, type LabMapScheme } from "./mapScheme";

/**
 * `createMap` with one thing added and nothing taken away.
 *
 * `lib/map.ts` cannot be reused directly here, and not because of style: it
 * hard-codes the dark scheme's own colours by fetching the style and handing it
 * straight to MapLibre. A direction needs the JSON repainted between those two
 * steps. Everything else in that file is load-bearing and is carried over
 * verbatim rather than reimplemented — each of these was a real failure once:
 *
 *  - `loadMapLibre()`, the raw ESM loader. Turbopack's bundled build of
 *    maplibre-gl produces a Web Worker that is constructed and immediately
 *    closed, silently, and every vector and GeoJSON layer then stays invisible
 *    while the basemap renders perfectly. Never import maplibre-gl for runtime.
 *  - `FALLBACK_STYLE` when the basemap is unreachable, so `load` still fires and
 *    the site's own layers still draw. Repainted too, so an outage degrades to
 *    the direction's land colour rather than to somebody else's near-black.
 *  - The missing-style-image resolver: OpenFreeMap's dark style names two images
 *    its sprite does not contain, and MapLibre warns per tile regardless of what
 *    a `styleimagemissing` listener does.
 *  - A `ResizeObserver`. MapLibre sizes itself once at construction and watches
 *    only *window* resizes, so in a flex layout it sticks at 400x300 — and this
 *    map sits beside a panel that collapses.
 *  - `relative h-full` on the container, which the caller owns: MapLibre 6 does
 *    not add its own class to the element it is handed, so a static container
 *    lets the absolutely-positioned canvas escape to the viewport.
 *  - Visible OSM attribution. That is a licensing requirement of both
 *    OpenStreetMap and OpenFreeMap, not a design preference, and no part of the
 *    redesign may cover it.
 *  - `onReady` at `style.load`, not `isStyleLoaded()`: the latter waits for
 *    every basemap tile in view, which put our first dot a full second behind
 *    the basemap on a phone.
 *
 * The style URL and the fetch are also identical, which is the point of doing
 * the repaint here: `/lab/<direction>/map` costs exactly what `/map` costs.
 */
export type LabMapHandle = {
  map: MLMap;
  ml: MapLibre;
  destroy: () => void;
};

async function loadLabBasemap(
  maptilerKey: string | undefined,
  locale: string,
  scheme: LabMapScheme | null,
): Promise<StyleSpecification> {
  const url = maptilerKey
    ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${maptilerKey}`
    : OPENFREEMAP_DARK;
  const paint = (style: StyleSpecification) =>
    scheme ? repaintBasemap(style, scheme) : style;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Labels first, then paint. transformBasemap rewrites every text-field for
    // the page's language and drops the maritime boundary lines; repainting
    // after it means the label colours it sets are the ones being replaced,
    // rather than the two passes fighting over the same property.
    return paint(transformBasemap((await res.json()) as StyleSpecification, locale));
  } catch (err) {
    // A handled degradation, not an error: the data still draws.
    console.warn(
      "[lab basemap] style unavailable, drawing on a plain background",
      err,
    );
    return paint(FALLBACK_STYLE);
  }
}

export async function createLabMap(
  container: HTMLElement,
  opts: {
    /** Read off the themed subtree with `readMapScheme`. Null leaves the style alone. */
    scheme: LabMapScheme | null;
    maptilerKey?: string;
    locale?: string;
    center?: [number, number];
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
    /** Runs once, at `style.load`: addSource and addLayer are legal from here. */
    onReady?: (map: MLMap) => void;
  },
): Promise<LabMapHandle> {
  const locale = opts.locale ?? (document.documentElement.lang || "zh-TW");
  const [ml, style] = await Promise.all([
    loadMapLibre(),
    loadLabBasemap(opts.maptilerKey, locale, opts.scheme),
  ]);

  const map = new ml.Map({
    container,
    style,
    center: opts.center ?? TAIWAN_CENTER,
    zoom: opts.zoom ?? 6.6,
    minZoom: opts.minZoom ?? 5,
    maxZoom: opts.maxZoom ?? 16,
    // No maxBounds, exactly as on /map. It is not a pan limit so much as a
    // camera override: whenever the viewport is wider than the bounds — which it
    // is at country zoom — MapLibre forces the view to fit them and throws the
    // deliberate framing away. minZoom still stops anyone reaching the globe.
    attributionControl: { compact: true },
  });

  map.on("error", (e) => {
    console.error("[lab maplibre]", (e as unknown as { error?: Error }).error ?? e);
  });

  map.setMissingStyleImageResolver((id) => {
    if (!map.hasImage(id)) {
      map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
    }
  });

  map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");

  let disposed = false;
  let done = false;
  map.once("style.load", () => {
    if (disposed || done) return;
    done = true;
    opts.onReady?.(map);
  });

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
