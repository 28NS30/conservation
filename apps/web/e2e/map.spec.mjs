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
 *
 * IT NOW FAILS. Until this commit it printed a JSON report and exited 0 come
 * what may, so CI's "Map renders end to end" proved that Chromium launched and
 * nothing else: a missing window.__map, a layer MapLibre had rejected, a
 * console error and a map drawing no features at all were all reported in the
 * output and all passed. Everything printed before is still printed — the
 * report is genuinely useful when something breaks — and five of those
 * conditions now exit 1.
 *
 * The screenshot is no longer committed. apps/web/e2e/map-render.png was in
 * git, 228 KB, rewritten by every run and compared against nothing: six commits
 * of binary churn pretending to be a baseline. It is written to the same path,
 * which .gitignore now covers and which ci.yml already uploads as an artifact,
 * so it is there when a failure needs looking at.
 */
import { chromium } from "playwright";
import { join } from "node:path";

// /map, not /: the home page hero runs the same component in presentation
// mode, which deliberately has no chrome, so it cannot stand in for the tool.
const URL_ = process.env.MAP_URL ?? "http://localhost:3000/map";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
const tileRequests = [];
page.on("console", (m) => {
  const t = m.text();
  if (
    m.type() === "error" ||
    t.startsWith("[layers]") ||
    t.startsWith("[createMap]")
  )
    consoleErrors.push(m.type() + ": " + t.slice(0, 260));
});
page.on("response", (r) => {
  if (r.url().includes("/api/tiles/"))
    tileRequests.push(`${r.status()} ${new URL(r.url()).pathname}`);
});
page.on("pageerror", (e) =>
  consoleErrors.push("pageerror: " + e.message.slice(0, 300)),
);

// Not "networkidle": a live map keeps fetching tiles, so the network never idles.
await page.goto(URL_, { waitUntil: "load" });

// Give MapLibre time to fetch and parse tiles.
await page.waitForTimeout(6000);

const state = await page.evaluate(() => {
  const m = window.__map;
  if (!m) return { error: "window.__map missing" };
  const src = m.getSource("reports-agg");
  return {
    center: m
      .getCenter()
      .toArray()
      .map((v) => +v.toFixed(3)),
    zoom: +m.getZoom().toFixed(2),
    tiles: src?.tiles,
    sourceLoaded: m.isSourceLoaded("reports-agg"),
    features: m.querySourceFeatures("reports-agg", { sourceLayer: "reports" })
      .length,
    // Whatever the ACTIVE mode draws, not one hard-coded layer. This counted
    // "reports-cells" only, so the day dots became the default it silently
    // reported 0 rendered features and still exited 0 — the one check that
    // proves the map paints at all, measuring nothing.
    renderedByMode: Object.fromEntries(
      ["reports-heat", "reports-cells", "reports-dots"]
        .filter((id) => m.getLayer(id))
        .map((id) => [
          id,
          {
            visible:
              (m.getLayoutProperty(id, "visibility") ?? "visible") !== "none",
            // A heatmap layer is not queryable by feature, so fall back to the
            // source it draws from.
            features:
              id === "reports-heat"
                ? m.querySourceFeatures("reports-agg", {
                    sourceLayer: "reports_dots",
                  }).length
                : m.queryRenderedFeatures({ layers: [id] }).length,
          },
        ]),
    ),
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

// Resolved from this file, not from the working directory. `npm run test:map`
// from the repo root delegates to the workspace and runs with cwd=apps/web, so
// a repo-relative path wrote apps/web/apps/web/e2e/map-render.png and the
// baseline beside this spec was never actually refreshed.
const SHOT = join(import.meta.dirname, "map-render.png");
const shot = await page.screenshot({ path: SHOT });
// Count saturated pixels in the PNG itself. readPixels() on MapLibre's canvas
// returns an empty buffer because it is created without preserveDrawingBuffer.
const painted = { screenshotBytes: shot.length };

console.log(
  JSON.stringify(
    {
      state,
      painted,
      tileRequests: tileRequests.slice(0, 12),
      consoleErrors: consoleErrors.slice(0, 40),
    },
    null,
    2,
  ),
);

console.log(`screenshot -> ${SHOT}`);

await browser.close();

/*
 * What has to be true for this page to be working.
 *
 * Platform-only 404s are excluded the way pages.spec.mjs excludes them:
 * Vercel serves /_vercel/insights/script.js itself, and under `next start` —
 * which is how CI and any self-hosted deploy runs — it cannot exist. Treating
 * that as a failure fails every run and reads as a site-wide breakage.
 */
const PLATFORM_ONLY = /_vercel|favicon/;
const real = consoleErrors.filter(
  (e) => /^(error|pageerror):/.test(e) && !PLATFORM_ONLY.test(e),
);
const served = tileRequests.filter((t) => t.startsWith("200 "));
// The mode the map is actually drawing in. A layer that is present but hidden
// is not evidence of anything.
const active = Object.entries(state.renderedByMode ?? {}).filter(
  ([, v]) => v.visible,
);

const problems = [];
if (state.error) problems.push(state.error + " — build with NEXT_PUBLIC_E2E=1");
if (state.missingLayers?.length)
  problems.push(
    `MapLibre rejected ${state.missingLayers.join(", ")} at addLayer time. It logs and carries on rendering without the layer, which is how a bad circle-radius blanked the dots across five zoom levels.`,
  );
if (!served.length)
  problems.push(`no /api/tiles/ response came back 200 (saw ${tileRequests.length})`);
if (!active.length) problems.push("no data layer is visible in the active mode");
else if (!active.some(([, v]) => v.features > 0))
  problems.push(
    `the visible layer(s) ${active.map(([id]) => id).join(", ")} drew 0 features. Either the paint broke or the database this ran against has no published reports in view.`,
  );
if (real.length) problems.push(...real);

if (problems.length) {
  console.error("\n  the map did not render:");
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(
  `\n  map renders: ${active.map(([id, v]) => `${id} ${v.features} features`).join(", ")}, ${served.length} tile(s) served`,
);
