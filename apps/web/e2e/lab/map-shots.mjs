/**
 * Shoot the lab map, in both locales, at both widths.
 *
 *   node apps/web/e2e/lab/map-shots.mjs
 *
 * Headless Chromium, never a hidden browser pane: MapLibre does all its work
 * inside requestAnimationFrame, and anything that suspends rAF shows a healthy
 * basemap over a permanently empty data layer with no error at all — which is
 * indistinguishable from a real bug (memory: "Hidden Browser pane stalls
 * MapLibre").
 *
 * Playwright sends no Accept-Language, so an unprefixed path renders zh-TW.
 * Both locales are therefore listed explicitly rather than assumed.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? join(import.meta.dirname, "shots");
const PATHS = (process.env.PATHS ?? "/lab/roundel/map,/en/lab/roundel/map")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "390x844", width: 390, height: 844 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const report = [];

for (const path of PATHS) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 240));
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 240)));

    await page.goto(BASE + path, { waitUntil: "load" });
    await page.waitForTimeout(8000);

    const state = await page.evaluate(() => {
      const m = window.__labMap;
      if (!m) return { error: "window.__labMap missing" };
      const ids = [
        "lab-reports-cells",
        "lab-reports-dots",
        "lab-reports-points",
        "lab-reports-heat",
        "lab-reports-select-ring",
      ];
      return {
        zoom: +m.getZoom().toFixed(2),
        center: m.getCenter().toArray().map((v) => +v.toFixed(3)),
        missingLayers: ids.filter((id) => !m.getLayer(id)),
        renderedCells: m.queryRenderedFeatures({ layers: ["lab-reports-cells"] })
          .length,
        // The repaint has to survive to the applied style, not just the JSON.
        background: m.getPaintProperty("background", "background-color"),
        water: m.getPaintProperty("water", "fill-color"),
        placeLabel: m.getPaintProperty("place_city", "text-color"),
        // Data must sit under the place names.
        dataUnderLabels:
          m.getStyle().layers.findIndex((l) => l.id === "lab-reports-cells") <
          m.getStyle().layers.findIndex((l) => l.id === "place_city"),
      };
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    const fonts = await page.evaluate(() => [...document.fonts].length);

    const file = join(
      OUT,
      `${path.replace(/\W+/g, "-").replace(/^-|-$/g, "")}-${vp.name}.png`,
    );
    await page.screenshot({ path: file });
    report.push({ path, viewport: vp.name, state, overflow, documentFonts: fonts, errors, file });
    await ctx.close();
  }
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
