/**
 * Every page, in a real browser, in both locales.
 *
 *   node e2e/pages.spec.mjs
 *
 * Catches three classes of failure that the unit and API tests structurally
 * cannot:
 *
 *  1. **Unresolved translations.** next-intl renders a missing message as its own
 *     key path ("map.cellCount") rather than throwing, so the page still returns
 *     200 and looks fine to any HTTP-level check. This has slipped through three
 *     separate times.
 *  2. **Client-side exceptions.** A component that throws after hydration leaves
 *     the server HTML on screen; the status code is still 200.
 *  3. **Layers that silently fail to be added.** MapLibre validates paint
 *     expressions at addLayer time, logs to the console, and carries on rendering
 *     the map without that layer. An invalid circle-radius once blanked the dots
 *     across five zoom levels with every test passing.
 */
import { chromium } from "playwright";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

const PAGES = [
  { path: "/", name: "map (zh-TW)", settle: 8000, layers: true },
  { path: "/en", name: "map (en)", settle: 8000, layers: true },
  { path: "/stats", name: "stats (zh-TW)" },
  { path: "/en/stats", name: "stats (en)" },
  { path: "/species", name: "species directory" },
  { path: "/species/28758-duttaphrynus-melanostictus", name: "species detail", settle: 7000 },
  { path: "/reports", name: "reports list" },
  { path: "/report", name: "submission form" },
  { path: "/about", name: "about" },
  { path: "/attribution", name: "attribution" },
  { path: "/privacy", name: "privacy" },
];

/** Namespaces from messages/*.json. A leaked key looks like `namespace.someKey`. */
const NAMESPACES = [
  "site", "nav", "categories", "precision", "stats", "statsPage", "map", "footer",
  "report", "detail", "admin", "login", "species", "offline", "errors",
  "attribution", "about", "privacy", "list",
];
const LEAKED_KEY = new RegExp(`\\b(?:${NAMESPACES.join("|")})\\.[a-zA-Z][a-zA-Z0-9]*\\b`, "g");

/** Data layers that must exist on any page showing a map. */
const REQUIRED_LAYERS = ["reports-cells", "reports-dots", "reports-points"];

const browser = await chromium.launch();
const failures = [];

for (const pg of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];

  page.on("pageerror", (e) => errs.push("uncaught: " + e.message.slice(0, 180)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (t.includes("favicon")) return; // not a product concern
    errs.push("console: " + t.slice(0, 180));
  });
  page.on("response", (r) => {
    if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });

  await page
    .goto(BASE + pg.path, { waitUntil: "load" })
    .catch((e) => errs.push("navigation failed: " + e.message.slice(0, 120)));
  await page.waitForTimeout(pg.settle ?? 2500);

  const body = await page.evaluate(() => document.body.innerText).catch(() => "");
  const leaked = body.match(LEAKED_KEY);
  if (leaked) errs.push("unresolved translations: " + [...new Set(leaked)].join(", "));

  if (pg.layers) {
    const missing = await page.evaluate((ids) => {
      const m = window.__map;
      if (!m) return ["window.__map missing"];
      return ids.filter((id) => !m.getLayer(id));
    }, REQUIRED_LAYERS);
    if (missing.length) errs.push("layers missing from the style: " + missing.join(", "));

    // The escape hatch from a canvas has to come BEFORE the canvas. A WebGL map
    // conveys nothing to a screen reader, so the link to the tabular equivalent
    // at /reports is a skip link — offscreen until focused. Placed after the map
    // it became the twelfth tab stop, behind the canvas, both zoom buttons and
    // the attribution, which is no use to anyone.
    const order = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return "(body)";
          return el.tagName.toLowerCase() === "canvas"
            ? "CANVAS"
            : (el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 24) || "");
        }),
      );
    }
    const canvasAt = order.indexOf("CANVAS");
    const listAt = order.findIndex((s) => s && (s.includes("列表") || s.toLowerCase().includes("list")));
    if (canvasAt !== -1 && (listAt === -1 || listAt > canvasAt)) {
      errs.push(`the "view as list" skip link must precede the map canvas in tab order (canvas at ${canvasAt}, link at ${listAt})`);
    }

    // Every control needs an accessible name.
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button, a, input, select")]
        .filter((el) => !(el.getAttribute("aria-label") || el.textContent?.trim() || el.getAttribute("placeholder") || el.getAttribute("title")))
        .map((el) => el.tagName.toLowerCase()),
    );
    if (unnamed.length) errs.push("controls with no accessible name: " + unnamed.join(", "));

    // The address bar has to track the view, or nobody can share what they are
    // looking at — and it has to do so with replaceState. router.replace would
    // refetch the server component on every pan, and pushState would fill the
    // history stack so the back button walks through every gesture instead of
    // leaving the site.
    const before = await page.evaluate(() => ({ search: location.search, len: history.length }));
    await page.evaluate(() => window.__map.jumpTo({ center: [121.52, 25.05], zoom: 12.3 }));
    await page.waitForTimeout(1400);
    const after = await page.evaluate(() => ({ search: location.search, len: history.length }));
    if (!/lng=/.test(after.search) || !/lat=/.test(after.search) || !/z=/.test(after.search)) {
      errs.push(`map view is not reflected in the URL after panning (got "${after.search}")`);
    }
    if (after.len !== before.len) {
      errs.push(`panning grew the history stack ${before.len} -> ${after.len}; use replaceState, not pushState`);
    }
  }

  if (errs.length) failures.push({ page: pg.name, path: pg.path, errs: [...new Set(errs)] });
  else console.log(`  ok   ${pg.name}`);
  await ctx.close();
}

await browser.close();

if (failures.length) {
  console.error("\n" + JSON.stringify(failures, null, 2));
  console.error(`\n${failures.length}/${PAGES.length} pages FAILED`);
  process.exit(1);
}
console.log(`\n${PAGES.length}/${PAGES.length} pages passed`);
