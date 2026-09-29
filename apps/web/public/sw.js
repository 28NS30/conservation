/**
 * Service worker: make the app openable without a signal.
 *
 * The offline queue is useless if the page won't load. If the tab is already
 * open, client-side navigation works without a service worker — but "closed the
 * tab, reopened in a valley" needs this.
 *
 * Deliberately runtime caching, with no build-time precache manifest. The
 * only thing Serwist or next-pwa would add is precaching Next's hashed chunks,
 * and that solves "first ever visit is offline", which essentially cannot happen:
 * the user loads the app before driving into the mountains. The one exception
 * is the report pages, which warm each other (warmReportPages, below).
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
    // A page warmed by warmReportPages() was fetched by the worker, not
    // navigated to, so its stored request carries different headers from the
    // browser's navigation — and a response that varies on a header would then
    // never match. A navigation only ever wants the page's HTML, and Next's RSC
    // requests carry their own `_rsc` query, so for navigations the headers
    // cannot pick the wrong response and are ignored.
    const hit = await cache.match(request, {
      ignoreSearch: false,
      ignoreVary: request.mode === "navigate",
    });
    if (hit) return hit;
    throw new Error("offline and not cached");
  }
}

/**
 * Every report page, cached as soon as any one of them is open.
 *
 * Runtime caching alone was enough while there was one report page: whoever
 * would need it offline had loaded it. With three pages and a chooser, a
 * reporter who had only ever opened the roadkill page found the wildlife page
 * would not open on the mountain road it was needed on. So a report page
 * (components/report/WarmReportPages.tsx) sends the chooser's and the three
 * pages' addresses in its own language, and the worker fetches each one, then
 * the scripts and stylesheets it names, into the same cache a visit would
 * have filled.
 *
 * Only these addresses, under this worker's scope, and only from our own
 * origin. The message comes from a page, and a worker that fetched whatever a
 * page named would be a fetch proxy for anything able to post to it. Never a
 * tile: OpenFreeMap's terms forbid automated collection (see above).
 */
const REPORT_PAGE_PATH = /^(?:\/en)?\/report(?:\/(?:roadkill|invasive|wildlife))?$/;
const NEXT_ASSET = /\/_next\/static\/[A-Za-z0-9_\-./~%]+?\.(?:js|css|woff2)/g;

async function warmReportPages(paths) {
  const scope = new URL(self.registration.scope).pathname.replace(/\/$/, "");
  const cache = await caches.open(SHELL);
  const assets = new Set();
  for (const path of Array.isArray(paths) ? paths : []) {
    if (typeof path !== "string" || !path.startsWith(`${scope}/`)) continue;
    if (!REPORT_PAGE_PATH.test(path.slice(scope.length))) continue;
    const url = new URL(path, self.location.origin);
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await cache.put(url, res);
      for (const m of html.matchAll(NEXT_ASSET)) assets.add(m[0]);
    } catch {
      // The signal went again. The next visit to a report page tries again.
    }
  }
  for (const asset of assets) {
    const url = new URL(asset, self.location.origin);
    if (await cache.match(url)) continue;
    try {
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
    } catch {
      /* as above */
    }
  }
}

self.addEventListener("message", (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  if (event.data?.type !== "warm-report-pages") return;
  event.waitUntil(warmReportPages(event.data.paths));
});

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
