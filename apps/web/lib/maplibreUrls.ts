import { withBase } from "@/lib/basePath";

/**
 * Where the vendored MapLibre modules are served from.
 *
 * One source of truth for the loader in lib/map.ts and the resource hints on
 * /map: a hint for a URL the loader does not request is a wasted download, and
 * a warning in every browser console.
 */
export const MAPLIBRE_URL = withBase("/maplibre/maplibre-gl.mjs");
export const MAPLIBRE_SHARED_URL = withBase("/maplibre/maplibre-gl-shared.mjs");
export const WORKER_URL = withBase("/maplibre/maplibre-gl-worker.mjs");
