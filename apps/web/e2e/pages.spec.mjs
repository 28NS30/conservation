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
  { path: "/", name: "home (zh-TW)", home: true },
  { path: "/en", name: "home (en)", home: true },
  { path: "/map", name: "map (zh-TW)", settle: 9000, layers: true },
  { path: "/en/map", name: "map (en)", settle: 9000, layers: true },
  { path: "/stats", name: "stats (zh-TW)" },
  { path: "/en/stats", name: "stats (en)" },
  { path: "/season", name: "season goal (zh-TW)" },
  { path: "/en/season", name: "season goal (en)" },
  { path: "/species", name: "species directory" },
  {
    path: "/species/28758-duttaphrynus-melanostictus",
    name: "species detail",
    settle: 7000,
  },
  { path: "/reports", name: "reports list" },
  { path: "/report", name: "submission form" },
  { path: "/about", name: "about" },
  { path: "/me", name: "my reports (signed out)" },
  { path: "/attribution", name: "attribution" },
  { path: "/privacy", name: "privacy" },
];

/** Namespaces from messages/*.json. A leaked key looks like `namespace.someKey`. */
const NAMESPACES = [
  "home",
  "season",
  "site",
  "nav",
  "me",
  "categories",
  "precision",
  "stats",
  "statsPage",
  "map",
  "footer",
  "report",
  "detail",
  "admin",
  "login",
  "species",
  "offline",
  "errors",
  "attribution",
  "about",
  "privacy",
  "list",
];
const LEAKED_KEY = new RegExp(
  `\\b(?:${NAMESPACES.join("|")})\\.[a-zA-Z][a-zA-Z0-9]*\\b`,
  "g",
);

/** Data layers that must exist on any page showing a map. */
const REQUIRED_LAYERS = ["reports-cells", "reports-dots", "reports-points"];

/**
 * The front page's layout promises, at the sizes people actually use.
 *
 * The owner asked for a much larger badge with only a little text beside it,
 * and the doors still have to be reachable without scrolling. Each of these
 * broke at least once while the page was being built.
 */
async function checkHome(page, pg, plate) {
  const errs = [];
  // [width, height, expected badge width or null to skip, Latin name must be one line]
  const sizes = [
    [1440, 900, 320, true],
    [1366, 700, 272, true], // a short laptop screen gets the smaller badge
    [640, 900, 272, true], // the narrowest sm layout, where the name once broke mid-word
    [390, 844, 172, true],
    [360, 740, null, true], // min(44vw, 172px) — about 158
    [320, 640, null, false], // the WCAG reflow width; no fold or one-line promise here
  ];
  for (const [w, h, badge, oneLine] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const img = document.querySelector("main section img");
      const doors = [...document.querySelectorAll('a[href*="/report?category="]')];
      const h1 = document.querySelector("main h1");
      const latin = [...(h1?.querySelectorAll("span") ?? [])].find((e) =>
        /^\s*Project FormosaWatch\s*$/i.test(e.textContent ?? ""),
      );
      // Lines of TEXT, from the text's own boxes. The element's box is one
      // rect whether or not the words inside it wrap, which is why an earlier
      // version of this check could never fail.
      const lineTops = (el) => {
        if (!el) return 0;
        // Text nodes only: the decorative dot beside the Latin name is an
        // element with its own box at a different height, and counted as a
        // second line of text.
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const tops = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) if (r.width > 0) tops.push(r.top);
        }
        tops.sort((a, b) => a - b);
        // Rects on one line can differ by a pixel; a new line is at least half
        // a line-height further down.
        let lines = 0;
        let last = -Infinity;
        for (const t of tops) if (t - last > 4) { lines++; last = t; }
        return lines;
      };
      const halves = [...(h1?.querySelectorAll('[lang="zh-TW"] > span') ?? [])];
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        badge: img ? Math.round(img.getBoundingClientRect().width) : 0,
        doorsBottom: Math.max(...doors.map((d) => d.getBoundingClientRect().bottom)),
        doors: doors.length,
        latinLines: lineTops(latin),
        latinOverflows: latin ? latin.scrollWidth > latin.clientWidth + 1 : true,
        // Neither half of the name may itself break across lines.
        brokenHalves: halves.filter((el) => lineTops(el) > 1).map((el) => el.textContent),
      };
    });
    const at = `${w}x${h}`;
    if (m.overflow) errs.push(`home scrolls sideways at ${at}`);
    if (badge !== null && m.badge !== badge)
      errs.push(`badge is ${m.badge}px at ${at}, expected ${badge}`);
    if (badge === null && m.badge > 158)
      errs.push(`badge is ${m.badge}px at ${at}, expected 158 or less`);
    if (m.doors !== 3) errs.push(`${m.doors} report doors at ${at}, expected 3`);
    if (w >= 360 && m.doorsBottom > h)
      errs.push(`report doors fall below the fold at ${at}`);
    if (oneLine && m.latinLines !== 1)
      errs.push(`"Project FormosaWatch" is on ${m.latinLines} lines at ${at}`);
    if (oneLine && m.latinOverflows)
      errs.push(`"Project FormosaWatch" overflows its column at ${at}`);
    if (m.brokenHalves.length)
      errs.push(`the name breaks inside ${m.brokenHalves.join(", ")} at ${at}`);
  }
  await page.setViewportSize({ width: 1000, height: 800 });
  if (plate.length) errs.push("home still requests /field.svg");
  if (pg.path.startsWith("/en")) {
    const marked = await page.evaluate(() => !!document.querySelector('h1 [lang="zh-TW"]'));
    if (!marked) errs.push("the Chinese name in the English h1 is not marked lang=zh-TW");
  }
  return errs;
}

const browser = await chromium.launch();
const failures = [];

for (const pg of PAGES) {
  // The browser's language set deliberately, to match the path. Playwright's
  // default context sends no Accept-Language at all, so unprefixed paths did
  // render Chinese before this; but that rested on a default, and next-intl
  // redirects an English-preferring browser from "/" to "/en" — which a
  // Playwright upgrade or a CI image with a locale set would have turned on
  // silently.
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 800 },
    locale: pg.path.startsWith("/en") ? "en-US" : "zh-TW",
  });
  const page = await ctx.newPage();
  const errs = [];
  // Before navigation, or the first load's requests are never seen.
  const plate = [];
  page.on("request", (r) => {
    if (r.url().includes("/field.svg")) plate.push(r.url());
  });

  page.on("pageerror", (e) =>
    errs.push("uncaught: " + e.message.slice(0, 180)),
  );
  // Requests that 404 only because the platform is not here. Vercel serves
  // /_vercel/insights/script.js itself; under `next start` — which is how CI and
  // any self-hosted deploy runs — it cannot exist. Treating that as a page error
  // failed all thirteen renders and read as a site-wide breakage.
  const PLATFORM_ONLY = /\/_vercel\//;

  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (t.includes("favicon")) return; // not a product concern
    // Console messages carry no URL, so a bare "Failed to load resource" is
    // matched against what actually 404'd on this page.
    if (/Failed to load resource/.test(t) && platformOnly404) return;
    errs.push("console: " + t.slice(0, 180));
  });
  let platformOnly404 = false;
  page.on("response", (r) => {
    if (r.status() === 404 && PLATFORM_ONLY.test(r.url()))
      platformOnly404 = true;
  });
  page.on("response", (r) => {
    if (r.status() >= 500)
      errs.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });

  await page
    .goto(BASE + pg.path, { waitUntil: "load" })
    .catch((e) => errs.push("navigation failed: " + e.message.slice(0, 120)));
  await page.waitForTimeout(pg.settle ?? 2500);

  const body = await page
    .evaluate(() => document.body.innerText)
    .catch(() => "");
  const leaked = body.match(LEAKED_KEY);
  if (leaked)
    errs.push("unresolved translations: " + [...new Set(leaked)].join(", "));

  if (pg.home) errs.push(...(await checkHome(page, pg, plate)));

  if (pg.layers) {
    const missing = await page.evaluate((ids) => {
      const m = window.__map;
      if (!m) return ["window.__map missing"];
      return ids.filter((id) => !m.getLayer(id));
    }, REQUIRED_LAYERS);
    if (missing.length)
      errs.push("layers missing from the style: " + missing.join(", "));

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
            : el.getAttribute("aria-label") ||
                el.textContent?.trim().slice(0, 24) ||
                "";
        }),
      );
    }
    const canvasAt = order.indexOf("CANVAS");
    const listAt = order.findIndex(
      (s) => s && (s.includes("列表") || s.toLowerCase().includes("list")),
    );
    if (canvasAt !== -1 && (listAt === -1 || listAt > canvasAt)) {
      errs.push(
        `the "view as list" skip link must precede the map canvas in tab order (canvas at ${canvasAt}, link at ${listAt})`,
      );
    }

    // Every control needs an accessible name.
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button, a, input, select")]
        .filter(
          (el) =>
            !(
              el.getAttribute("aria-label") ||
              el.textContent?.trim() ||
              el.getAttribute("placeholder") ||
              el.getAttribute("title")
            ),
        )
        .map((el) => el.tagName.toLowerCase()),
    );
    if (unnamed.length)
      errs.push("controls with no accessible name: " + unnamed.join(", "));

    // The address bar has to track the view, or nobody can share what they are
    // looking at — and it has to do so with replaceState. router.replace would
    // refetch the server component on every pan, and pushState would fill the
    // history stack so the back button walks through every gesture instead of
    // leaving the site.
    const before = await page.evaluate(() => ({
      search: location.search,
      len: history.length,
    }));
    const hasHandle = await page.evaluate(
      () => typeof window.__map?.jumpTo === "function",
    );
    if (!hasHandle) {
      errs.push(
        "window.__map is missing — build with NEXT_PUBLIC_E2E=1 so the map spec " +
          "can drive the view (a production build deliberately exposes nothing)",
      );
    } else {
      await page.evaluate(() =>
        window.__map.jumpTo({ center: [121.52, 25.05], zoom: 12.3 }),
      );
    }
    await page.waitForTimeout(1400);
    const after = await page.evaluate(() => ({
      search: location.search,
      len: history.length,
    }));
    if (
      !/lng=/.test(after.search) ||
      !/lat=/.test(after.search) ||
      !/z=/.test(after.search)
    ) {
      errs.push(
        `map view is not reflected in the URL after panning (got "${after.search}")`,
      );
    }
    if (after.len !== before.len) {
      errs.push(
        `panning grew the history stack ${before.len} -> ${after.len}; use replaceState, not pushState`,
      );
    }
  }

  if (errs.length)
    failures.push({ page: pg.name, path: pg.path, errs: [...new Set(errs)] });
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
