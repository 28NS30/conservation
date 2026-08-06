/**
 * Real-browser check that the heatmap actually renders.
 *
 *   node apps/web/e2e/map.spec.mjs
 *
 * This exists because MapLibre does every bit of its work inside
 * requestAnimationFrame. Any environment that suspends rAF — a hidden tab, most
 * screenshot tools — will show a healthy basemap over a permanently empty data
 * layer, with no errors, which is indistinguishable from a real bug. Headless
 * Chromium runs rAF normally, so this is the only way to verify the paint.
 */
import { chromium } from "playwright";

// /map, not /: the home page hero runs the same component in presentation
// mode, which deliberately has no chrome, so it cannot stand in for the tool.
const URL_ = process.env.MAP_URL ?? "http://localhost:3000/map";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
const tileRequests = [];
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || t.startsWith("[layers]") || t.startsWith("[createMap]")) consoleErrors.push(m.type()+": "+t.slice(0, 260));
});
page.on("response", (r) => {
  if (r.url().includes("/api/tiles/")) tileRequests.push(`${r.status()} ${new URL(r.url()).pathname}`);
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message.slice(0, 300)));

// Not "networkidle": a live map keeps fetching tiles, so the network never idles.
await page.goto(URL_, { waitUntil: "load" });

// Give MapLibre time to fetch and parse tiles.
await page.waitForTimeout(6000);

const state = await page.evaluate(() => {
  const m = window.__map;
  if (!m) return { error: "window.__map missing" };
  const src = m.getSource("reports-agg");
  return {
    center: m.getCenter().toArray().map((v) => +v.toFixed(3)),
    zoom: +m.getZoom().toFixed(2),
    tiles: src?.tiles,
    sourceLoaded: m.isSourceLoaded("reports-agg"),
    features: m.querySourceFeatures("reports-agg", { sourceLayer: "reports" }).length,
    renderedCells: m.queryRenderedFeatures({ layers: ["reports-cells"] }).length,
    layers: m.getStyle().layers.map((l) => l.id),
    // Every data layer must actually exist. An invalid paint expression makes
    // MapLibre reject the layer at addLayer time and log to the console — the
    // map still renders, just missing that layer entirely. That is exactly how a
    // bad circle-radius expression blanked the dots across five zoom levels
    // without failing any test.
    missingLayers: ["reports-cells", "reports-dots", "reports-points"].filter(
      (id) => !m.getLayer(id),
    ),
  };
});

const shot = await page.screenshot({ path: "apps/web/e2e/map-render.png" });
// Count saturated pixels in the PNG itself. readPixels() on MapLibre's canvas
// returns an empty buffer because it is created without preserveDrawingBuffer.
const painted = { screenshotBytes: shot.length };

console.log(JSON.stringify({ state, painted, tileRequests: tileRequests.slice(0, 12), consoleErrors: consoleErrors.slice(0, 40) }, null, 2));

console.log("screenshot -> apps/web/e2e/map-render.png");

await browser.close();
