/**
 * The map budget: a lab map must look completely different and cost the same.
 *
 *   node apps/web/e2e/lab/budgets.mjs
 *   PATHS=/map,/en/lab/roundel/map node apps/web/e2e/lab/budgets.mjs
 *
 * Three numbers decide whether a redesign of /map is affordable, and none of
 * them is visible on screen:
 *
 *   1. how many `/api/tiles` requests the first view costs — the repaint must
 *      not move the camera somewhere that asks for more tiles than today's;
 *   2. whether the page loads a web font — direction.md §2.6 rule 8 is that
 *      /map gains no font, and the day the display subsets land a single
 *      `--font-display` reference on this route would break it silently;
 *   3. what KINDS of request it makes at all, by resource type and host, so a
 *      new third-party or a new class of asset shows up as a line that today's
 *      /map does not have.
 *
 * Run in headless Chromium rather than a hidden pane: MapLibre does all its work
 * inside requestAnimationFrame, and a suspended rAF reports a map that never
 * asks for a tile (memory: "Hidden Browser pane stalls MapLibre").
 *
 * Playwright sends no Accept-Language, so an unprefixed path renders zh-TW. Both
 * locales are listed explicitly where the locale could matter.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PATHS = (process.env.PATHS ?? "/map,/lab/roundel/map,/en/lab/roundel/map")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "390x844", width: 390, height: 844 },
];
/** Long enough for the style, the first tiles and the layers they trigger. */
const WAIT = Number(process.env.WAIT ?? 9000);

const browser = await chromium.launch();
const rows = [];

for (const path of PATHS) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const tiles = [];
    const fontRequests = [];
    const kinds = new Map();
    const errors = [];

    page.on("request", (r) => {
      const url = r.url();
      if (url.includes("/api/tiles/")) tiles.push(url);
      // `next dev` serves its own error overlay in Geist from /__nextjs_font/,
      // on whichever route happened to open the overlay. It does not exist in a
      // production build, and counting it makes a budget of zero fail at random
      // on a developer's machine — the same exclusion `e2e/lab/fonts.mjs` makes.
      if (
        (r.resourceType() === "font" || /\.(woff2?|ttf|otf)(\?|$)/.test(url)) &&
        !url.includes("/__nextjs_font/")
      )
        fontRequests.push(url);
      const key = `${r.resourceType()} ${new URL(url).host}`;
      kinds.set(key, (kinds.get(key) ?? 0) + 1);
    });
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 200));
    });
    page.on("pageerror", (e) =>
      errors.push("pageerror: " + e.message.slice(0, 200)),
    );

    // Not "networkidle": a live map keeps fetching tiles, so it never idles.
    await page.goto(BASE + path, { waitUntil: "load" });
    await page.waitForTimeout(WAIT);

    const camera = await page.evaluate(() => {
      const m = window.__labMap ?? window.__map;
      if (!m) return null;
      const b = m.getBounds();
      return {
        center: m.getCenter().toArray().map((v) => +v.toFixed(3)),
        zoom: +m.getZoom().toFixed(2),
        west: +b.getWest().toFixed(3),
        east: +b.getEast().toFixed(3),
        south: +b.getSouth().toFixed(3),
        north: +b.getNorth().toFixed(3),
      };
    });

    rows.push({
      path,
      viewport: vp.name,
      tileRequests: tiles.length,
      fontRequests: fontRequests.length,
      fontUrls: [...new Set(fontRequests)],
      camera,
      requestKinds: Object.fromEntries([...kinds.entries()].sort()),
      errors: errors.slice(0, 10),
    });
    await ctx.close();
  }
}

console.log(JSON.stringify(rows, null, 2));
await browser.close();
