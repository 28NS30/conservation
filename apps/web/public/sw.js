/**
 * Service worker: make the app openable without a signal.
 *
 * The offline queue is useless if the page won't load. If the tab is already
 * open, client-side navigation works without a service worker — but "closed the
 * tab, reopened in a valley" needs this.
 *
 * Deliberately runtime caching only, with no build-time precache manifest. The
 * only thing Serwist or next-pwa would add is precaching Next's hashed chunks,
 * and that solves "first ever visit is offline", which essentially cannot happen:
 * the user loads the app before driving into the mountains.
 */

// v2 empties the old tile cache. Its basemap entries are CARTO tiles, which the
// site stopped requesting when CARTO began watermarking keyless tiles
// (September 2026); there is no reason to keep them occupying the cap.
const VERSION = "v2";
const SHELL = `shell-${VERSION}`;
const TILES = `tiles-${VERSION}`;
// Sized down from 400 for vector tiles, which run to 100-220 KB each at low zoom
// against the few KB of the raster PNGs the old figure was chosen for. Vector
// tiles overzoom, so fewer entries still cover more ground.
const MAX_TILE_ENTRIES = 150;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/** Keep a cache from growing without bound; oldest entries go first. */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

async function networkFirst(request, cacheName, timeoutMs = 3500) {
  const cache = await caches.open(cacheName);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: false });
    if (hit) return hit;
    throw new Error("offline and not cached");
  }
}

async function staleWhileRevalidate(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone()).then(() => trim(cacheName, max));
      return res;
    })
    .catch(() => hit);
  return hit ?? network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache submissions, auth, or the classify worker — a stale response
  // here would be actively wrong.
  if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/tiles/")) return;
  if (url.pathname.startsWith("/auth/")) return;

  // Basemap and our own vector tiles: serve instantly, refresh in the background.
  // OpenFreeMap serves the style, TileJSON, tiles, glyphs and sprite from one
  // host, and all of them are needed to draw the basemap offline. Only what the
  // map itself asks for is cached: OpenFreeMap's terms forbid automated
  // collection, so nothing here may ever prefetch.
  if (url.pathname.startsWith("/api/tiles/") || url.hostname === "tiles.openfreemap.org") {
    event.respondWith(staleWhileRevalidate(request, TILES, MAX_TILE_ENTRIES));
    return;
  }

  // App shell, Next chunks, the vendored MapLibre bundle.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, SHELL));
  }
});

/**
 * Background Sync — Chromium only.
 *
 * Safari and iOS do not implement this, so it is a bonus path, not the mechanism
 * the feature relies on. The page-open flush in lib/offline/flush.ts is what
 * actually carries it.
 */
self.addEventListener("sync", (event) => {
  if (event.tag !== "flush-reports") return;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
      // The queue lives in IndexedDB and the pipeline needs Supabase's client, so
      // ask an open page to flush rather than duplicating the pipeline here.
      for (const client of clients) client.postMessage({ type: "flush-reports" });
    })(),
  );
});
