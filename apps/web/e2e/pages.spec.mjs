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
  { path: "/en/stats", name: "stats (en)", widths: true },
  { path: "/season", name: "season goal (zh-TW)" },
  { path: "/en/season", name: "season goal (en)" },
  { path: "/species", name: "species directory" },
  { path: "/en/species", name: "species directory (en)", widths: true },
  {
    path: "/species/28758-duttaphrynus-melanostictus",
    name: "species detail",
    settle: 7000,
  },
  { path: "/reports", name: "reports list", widths: true },
  { path: "/login", name: "sign in", widths: true },
  { path: "/report", name: "report chooser", widths: true },
  { path: "/en/report", name: "report chooser (en)", widths: true },
  { path: "/report/roadkill", name: "roadkill report", settle: 4000, widths: true },
  { path: "/en/report/invasive", name: "invasive report (en)", settle: 4000, widths: true },
  { path: "/report/wildlife", name: "wildlife report", settle: 4000 },
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
 * The page was rebuilt in September 2026 to the team's design brief (a split
 * hero with rotating photographs, then photograph rows alternating side to
 * side). The promises below are the old page's, carried over rather than
 * dropped, each in the form the new layout needs:
 *
 * - A WAY TO REPORT WITHOUT SCROLLING. The old page kept its three doors above
 *   the fold on a 360x740 phone. Now the header's "File a report" block is
 *   sticky, on screen at every size, and it opens exactly the three report
 *   types, so the promise holds on every page, not only this one.
 * - NO PHRASE OF THE HEADLINE BREAKS INSIDE ITSELF. The old check stopped the
 *   name breaking as 福爾摩沙守望 / 計畫. The new headline is bound into
 *   phrases (never "WILDLIFE, ON / THE RECORD", never 野生 / 動物), and this is
 *   what notices if that binding is lost.
 * - THE CHINESE NAME IS MARKED AS CHINESE in the English page, so a screen
 *   reader does not read 福爾摩沙守望計畫 as English. It moved from the h1 to
 *   the line above it.
 * - EVERY PHOTOGRAPH CARRIES ITS CREDIT. They are CC BY and CC BY-SA, which
 *   require one; a row added without a credit would be a licence breach.
 */
async function checkHome(page, pg, plate) {
  const errs = [];
  const sizes = [
    [1440, 900],
    [1366, 700],
    [640, 900],
    [390, 844],
    [360, 740],
    [320, 640], // the WCAG reflow width
  ];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      // Lines of TEXT, from the text's own boxes: an element's box is one rect
      // whether or not the words inside it wrap.
      const lineTops = (el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const tops = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) if (r.width > 0) tops.push(r.top);
        }
        tops.sort((a, b) => a - b);
        let lines = 0;
        let last = -Infinity;
        for (const t of tops) if (t - last > 4) { lines++; last = t; }
        return lines;
      };
      const header = document.querySelector("header");
      const report = header?.querySelector("details > summary");
      const rr = report?.getBoundingClientRect();
      // Each to its own report page (/report/roadkill, /invasive, /wildlife).
      const kind = (a) => /\/report\/(roadkill|invasive|wildlife)$/.exec(new URL(a.href).pathname)?.[1];
      const choices = [...(header?.querySelectorAll('details a[href*="/report/"]') ?? [])]
        .map(kind)
        .filter(Boolean);
      const rows = [...document.querySelectorAll('main a[href*="/report/"]')]
        .map(kind)
        .filter(Boolean);
      const phrases = [...(document.querySelector("main h1")?.querySelectorAll(".inline-block") ?? [])];
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        reportVisible: !!rr && rr.width > 0 && rr.height >= 24 && rr.top >= 0 && rr.bottom <= innerHeight,
        choices,
        rows,
        phrases: phrases.length,
        brokenPhrases: phrases.filter((el) => lineTops(el) > 1).map((el) => el.textContent),
      };
    });
    const at = `${w}x${h}`;
    if (m.overflow) errs.push(`home scrolls sideways at ${at}`);
    if (!m.reportVisible) errs.push(`the header's "File a report" block is not on screen at ${at}`);
    if (new Set(m.choices).size !== 3)
      errs.push(`the report menu offers ${m.choices.join(",") || "nothing"} at ${at}, expected three distinct types`);
    if (new Set(m.rows).size !== 3)
      errs.push(`the page's report rows offer ${m.rows.join(",") || "nothing"} at ${at}, expected three distinct types`);
    if (m.phrases < 2) errs.push(`the headline is not bound into phrases at ${at}`);
    if (m.brokenPhrases.length)
      errs.push(`the headline breaks inside "${m.brokenPhrases.join('", "')}" at ${at}`);
  }
  await page.setViewportSize({ width: 1000, height: 800 });
  if (plate.length) errs.push("home still requests /field.svg");

  const credits = await page.evaluate(() => {
    const figures = [...document.querySelectorAll("main figure")];
    const hero = document.querySelector('main [aria-roledescription="carousel"]');
    return {
      figures: figures.length,
      uncredited: figures.filter((f) => !/CC BY/.test(f.querySelector("figcaption")?.textContent ?? "")).length,
      heroCredited: !!hero && /CC BY/.test(hero.textContent ?? ""),
    };
  });
  if (credits.figures < 6) errs.push(`expected six photograph rows, found ${credits.figures}`);
  if (credits.uncredited) errs.push(`${credits.uncredited} photograph(s) without a CC credit`);
  if (!credits.heroCredited) errs.push("the hero photograph has no CC credit");

  if (pg.path.startsWith("/en")) {
    const marked = await page.evaluate(() =>
      [...document.querySelectorAll('main [lang="zh-TW"]')].some((e) => e.textContent?.includes("福爾摩沙守望計畫")),
    );
    if (!marked) errs.push("the Chinese name on the English page is not marked lang=zh-TW");
  }
  return errs;
}

/**
 * Nothing may scroll sideways on a phone.
 *
 * Horizontal overflow is invisible on a laptop and unusable on a handset: the
 * reader drags the page left to read the end of a line and everything else goes
 * with it. It is also silent — no error, no warning, the page returns 200 — and
 * it was live on two English pages, which is the other half of the point: these
 * widths are checked in English because Latin binomials are two or three times
 * the width of the Chinese names beside them, so the Chinese pages were clean
 * while /en/stats laid out 421px inside a 390px viewport.
 *
 * 320px is the WCAG reflow width; 360 and 390 are the two commonest phones.
 */
async function checkWidths(page) {
  const errs = [];
  for (const w of [320, 360, 390]) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      if (doc.scrollWidth <= innerWidth) return null;
      // Name what is actually sticking out, or the failure is a number with
      // nowhere to start looking.
      const culprits = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
        .slice(-3)
        .map((el) => `<${el.tagName.toLowerCase()} class="${el.className}">`);
      return { sw: doc.scrollWidth, iw: innerWidth, culprits };
    });
    if (m)
      errs.push(
        `scrolls sideways at ${w}px: ${m.sw} > ${m.iw} — ${m.culprits.join(" ")}`,
      );
  }
  await page.setViewportSize({ width: 1000, height: 800 });
  return errs;
}

/**
 * What the reader chose has to survive the next thing they do.
 *
 * Every one of these was a real loss of state, and all three were silent: the
 * page reloaded, looked right, and showed a different view of the data from the
 * one that had been asked for. That is worse than an error, because the reader
 * has no reason to distrust it.
 */
async function checkState(browser) {
  const errs = [];

  // A language switch keeps the whole address, not just the path.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1100, height: 850 },
      locale: "en-US",
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/en/reports?taxonId=28758&from=2015-01-01", {
      waitUntil: "load",
    });
    await page.waitForTimeout(2500);
    await page.click('button[lang="zh-TW"]');
    await page.waitForTimeout(2500);
    const at = await page.evaluate(() => location.pathname + location.search);
    if (!at.startsWith("/reports"))
      errs.push(`switching to zh-TW left /en/reports at "${at}"`);
    for (const want of ["taxonId=28758", "from=2015-01-01"])
      if (!at.includes(want))
        errs.push(`switching language dropped ${want} (got "${at}")`);
    await ctx.close();
  }

  // Including the map view, which is written with replaceState and so exists
  // only in `location` — the value has to be read at click time.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1100, height: 850 },
      locale: "en-US",
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/en/map?lng=120.5&lat=23.5&z=9", {
      waitUntil: "load",
    });
    await page.waitForTimeout(9000);
    await page.click('button[lang="zh-TW"]');
    await page.waitForTimeout(6000);
    const at = await page.evaluate(() => location.pathname + location.search);
    const p = new URLSearchParams(at.split("?")[1] ?? "");
    if (!at.startsWith("/map"))
      errs.push(`switching to zh-TW left /en/map at "${at}"`);
    // Within 0.01: the map may settle a fraction off the requested centre, and
    // the URL is rewritten from where it actually is.
    for (const [k, want] of [
      ["lng", 120.5],
      ["lat", 23.5],
    ]) {
      const got = Number(p.get(k));
      if (!Number.isFinite(got) || Math.abs(got - want) > 0.01)
        errs.push(`switching language moved the map: ${k}=${p.get(k)}`);
    }
    await ctx.close();
  }

  // The species box rebuilds the whole address, so the filter chip survives
  // both typing and clearing.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1100, height: 850 },
      locale: "zh-TW",
    });
    const page = await ctx.newPage();
    await page.goto(BASE + "/species?filter=invasive", { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const chosen = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("nav a")]
          .filter((a) => a.className.includes("bg-ink-900"))
          .map((a) => a.textContent.trim()),
      );
    for (const [what, text] of [
      ["typing", "龜"],
      ["clearing", ""],
    ]) {
      await page.fill('input[type="search"]', text);
      await page.waitForTimeout(2500);
      const at = await page.evaluate(() => location.search);
      if (!at.includes("filter=invasive"))
        errs.push(`${what} in the species box dropped the filter (got "${at}")`);
      if (at.includes("page="))
        errs.push(`${what} in the species box kept a page number ("${at}")`);
      const chips = await chosen();
      if (chips.length !== 1 || chips[0] !== "入侵種")
        errs.push(
          `after ${what}, the chip drawn as chosen is ${JSON.stringify(chips)}`,
        );
    }
    await ctx.close();
  }

  return errs;
}

const browser = await chromium.launch();
const failures = [];
const CHECKS = PAGES.length + 1;

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
  if (pg.widths) errs.push(...(await checkWidths(page)));

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

const stateErrs = await checkState(browser);
if (stateErrs.length)
  failures.push({ page: "URL state", path: "(several)", errs: stateErrs });
else console.log("  ok   URL state survives a language switch and a search");

await browser.close();

if (failures.length) {
  console.error("\n" + JSON.stringify(failures, null, 2));
  console.error(`\n${failures.length}/${CHECKS} checks FAILED`);
  process.exit(1);
}
console.log(`\n${CHECKS}/${CHECKS} checks passed`);
