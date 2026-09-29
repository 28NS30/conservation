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

// v2 emptied the old tile cache of CARTO's watermarked tiles (September 2026).
// v3 empties the shell cache, because v2 kept every page it was shown: a
// moderator's /admin with exact coordinates, a person's /me with their email,
// served again after sign-out to the next person on the device (security audit,
// 29 September 2026). Only the pages listed in OFFLINE_PAGES are kept now.
const VERSION = "v3";
const SHELL = `shell-${VERSION}`;
const TILES = `tiles-${VERSION}`;
// Sized down from 400 for vector tiles, which run to 100-220 KB each at low zoom
// against the few KB of the raster PNGs the old figure was chosen for. Vector
// tiles overzoom, so fewer entries still cover more ground.
const MAX_TILE_ENTRIES = 150;
// The shell holds a few dozen pages and their RSC payloads, plus the hashed
// scripts they name. It had no cap, and RSC prefetches alone could fill it.
const MAX_SHELL_ENTRIES = 250;

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

/**
 * The network, unless it is slow or gone and there is a copy.
 *
 * It used to abort every request after 3.5 s and fall back to the cache, which
 * on a slow but working connection failed any page with no copy (ERR_FAILED on
 * a navigation) instead of waiting for it. Now a slow response only gives way
 * to a copy that exists; with none, the page waits for the network as the
 * browser would have without a worker.
 *
 * `store` is false for everything outside OFFLINE_PAGES: such a response is
 * passed through and never written down.
 */
async function networkFirst(request, cacheName, { store = true, timeoutMs = 3500 } = {}) {
  const cache = await caches.open(cacheName);
  const network = fetch(request).then((res) => {
    if (store && res.ok) {
      cache.put(request, res.clone()).then(() => trim(cacheName, MAX_SHELL_ENTRIES), () => {});
    }
    return res;
  });
  // A copy for a navigation ignores Vary: a page warmed by warmReportPages()
  // was fetched by the worker, not navigated to, so its stored request carries
  // different headers from the browser's. Next's RSC requests carry their own
  // `_rsc` query, so for navigations the headers cannot pick the wrong page.
  const copy = () =>
    store
      ? cache.match(request, { ignoreSearch: false, ignoreVary: request.mode === "navigate" })
      : Promise.resolve(undefined);

  let timer;
  const slow = new Promise((resolve) => {
    timer = setTimeout(() => resolve(SLOW), timeoutMs);
  });
  try {
    const first = await Promise.race([network, slow]);
    if (first !== SLOW) return first;
    const hit = await copy();
    if (hit) {
      network.catch(() => {}); // it may still arrive, and refresh the copy
      return hit;
    }
    return await network;
  } catch {
    const hit = await copy();
    if (hit) return hit;
    throw new Error("offline and not cached");
  } finally {
    clearTimeout(timer);
  }
}
const SLOW = Symbol("slow");

/** Hashed build output never changes under its name: the copy is the file. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone()).then(() => trim(cacheName, MAX_SHELL_ENTRIES), () => {});
  return res;
}

/**
 * The pages worth having without a signal, and nothing else.
 *
 * Public pages only, identical for every visitor apart from the header's
 * sign-in link: the home page, the map, the report chooser and its three
 * pages (the reason the worker exists), and the pages a reporter reads about
 * an animal. Never /admin, /me, /login, /community, a record's own page (a
 * receipt, a moderator's view of a test report, or a record since withdrawn)
 * or anything unknown: a copy of those is one person's data kept on a device
 * that may be shared, or a public page that has since stopped being public.
 */
const OFFLINE_PAGES =
  /^(?:\/en)?(?:\/|\/map|\/report(?:\/(?:roadkill|invasive|wildlife))?|\/species(?:\/[^/]+)?|\/stats|\/about|\/privacy|\/terms|\/attribution|\/roadkill|\/invasive|\/wildlife)?\/?$/;
/** Files served from public/, and the vendored map bundle. */
const PUBLIC_FILE = /\.(?:png|jpe?g|webp|avif|svg|ico|woff2?|webmanifest|mjs)$/;

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
  if (event.data?.type === "warm-report-pages") {
    event.waitUntil(warmReportPages(event.data.paths));
  }
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

  if (url.origin !== self.location.origin) return;

  // Paths below the worker's scope, which carries the site's base path.
  const scope = new URL(self.registration.scope).pathname.replace(/\/$/, "");
  const path = url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) || "/" : url.pathname;

  // Next's hashed chunks and fonts.
  if (path.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }
  // The pages and files the offline report flow needs, kept for next time.
  if (OFFLINE_PAGES.test(path) || PUBLIC_FILE.test(path)) {
    event.respondWith(networkFirst(request, SHELL));
    return;
  }
  // Everything else goes to the network and is never written down.
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
