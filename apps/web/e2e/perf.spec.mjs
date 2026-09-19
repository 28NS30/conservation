/**
 * The load path of /map, guarded.
 *
 *   node e2e/perf.spec.mjs
 *   UPDATE_PERF=1 node e2e/perf.spec.mjs    # record today's numbers as the budget
 *
 * The map was made fast on purpose and nothing measured it afterwards. The
 * resource hints in MapHints.tsx carry their own evidence — "the map constructed
 * about 80-100 ms sooner on a desktop, and the first tile arrived about half a
 * second sooner on a phone over 4G" — and a single deleted line puts that back
 * with no test turning red. The tiles are gzipped and one client refusing gzip
 * once poisoned a shared cache entry for a day (#42, #43); nothing watches the
 * encoding from the browser's side. This does.
 *
 * TWO KINDS OF CHECK, DELIBERATELY DIFFERENT.
 *
 *   structural  Hard failures. A hint is present or it is not; a font request
 *               happened or it did not; a tile came back gzipped or it did not.
 *               None of these depend on how loaded the runner is.
 *   budgets     Bytes and milliseconds, compared against e2e/perf-budget.json.
 *               A CI runner's timings are noisy, so the timing ceiling is
 *               generous and the number that means anything is the one recorded
 *               from production. Byte budgets are real gates once recorded.
 *
 * THE BUDGET FILE SHIPS UNRECORDED. Writing this harness needed a served site
 * and there was none; every `null` in perf-budget.json is a number nobody has
 * measured yet. Unrecorded budgets print and do not fail, because a budget
 * invented at a desk is worse than an honest blank — it would be enforced for
 * years as though someone had meant it.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE } from "./routes.mjs";

const BUDGET_PATH = join(import.meta.dirname, "perf-budget.json");

/** A webfont on /map would block the first paint of a page that has none today. */
const FONT = /\.(woff2?|ttf|otf|eot)(\?|$)|fonts\.(googleapis|gstatic)\.com/i;

/**
 * MapLibre's two module chunks and the basemap style, as MapHints.tsx names
 * them, read as attributes rather than matched as text.
 *
 * An earlier version of this was four regexes over the raw HTML with the
 * attributes in the order React happens to emit them today. That is a test of
 * React's serialiser, not of the hints: `href` before `rel` would have failed
 * every one of them while the page was perfectly correct.
 */
export const WANTED = [
  {
    what: "modulepreload maplibre-gl.mjs",
    ok: (l) => l.rel === "modulepreload" && /\/maplibre-gl\.mjs(\?|$)/.test(l.href),
  },
  {
    what: "modulepreload maplibre-gl-shared.mjs",
    ok: (l) => l.rel === "modulepreload" && /\/maplibre-gl-shared\.mjs(\?|$)/.test(l.href),
  },
  {
    what: "preconnect tiles.openfreemap.org",
    ok: (l) => l.rel === "preconnect" && l.href.includes("tiles.openfreemap.org"),
  },
  {
    what: "preload of the OpenFreeMap style",
    ok: (l) => l.rel === "preload" && l.href.includes("tiles.openfreemap.org"),
  },
];

/** Every <link> in a string of HTML, as {rel, href, as}. */
export function linkTags(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => {
    const attr = (name) =>
      (m[0].match(new RegExp(`\\b${name}=("[^"]*"|'[^']*'|[^\\s>]+)`, "i")) ?? [])[1]?.replace(/^['"]|['"]$/g, "") ?? "";
    return { rel: attr("rel"), href: attr("href"), as: attr("as") };
  });
}

/**
 * @param html  the document as it arrived
 * @param dom   the links in the page after hydration
 *
 * A hint that is in the DOM but not in the HTML is reported separately and does
 * not fail. app/[locale]/map/layout.tsx exists so these reach the first HTML
 * flush rather than the streamed page behind the statistics query, so arriving
 * late is worth saying out loud — but it is a weaker claim than "the hint is
 * gone", and only the strong one should stop a merge.
 */
export function checkHints(html, dom = []) {
  const inHtml = linkTags(html);
  const errs = [];
  const late = [];
  for (const want of WANTED) {
    if (inHtml.some(want.ok)) continue;
    if (dom.some(want.ok)) {
      late.push(
        `${want.what} is in the DOM but not in the HTML that arrived. app/[locale]/map/layout.tsx puts MapHints outside the Suspense boundary precisely so it reaches the first flush.`,
      );
      continue;
    }
    errs.push(
      `${want.what} is missing. components/map/MapHints.tsx is where it comes from; deleting a line there is silent everywhere else, and it is worth about half a second of first tile on a phone over 4G.`,
    );
  }
  return { errs, late };
}

/** One load of a page, reporting what it fetched and how fast it painted. */
async function load(browser, path, { width = 1440, locale = "zh-TW" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale });
  const page = await ctx.newPage();
  const started = Date.now();
  const fonts = [];
  const tiles = [];
  let firstTile = null;
  let requests = 0;
  page.on("request", () => {
    requests++;
  });
  page.on("response", (r) => {
    const url = r.url();
    if (FONT.test(url)) fonts.push(url);
    if (url.includes("/api/tiles/")) {
      if (firstTile === null && r.status() === 200) firstTile = Date.now() - started;
      tiles.push({
        status: r.status(),
        encoding: r.headers()["content-encoding"] ?? "(none)",
        path: new URL(url).pathname,
      });
    }
  });
  const res = await page.goto(BASE + path, { waitUntil: "load" }).catch(() => null);
  const html = res ? await res.text().catch(() => "") : "";
  await page.waitForTimeout(path.includes("map") ? 9000 : 4000);
  const domLinks = await page
    .evaluate(() =>
      [...document.querySelectorAll("link")].map((l) => ({
        rel: l.getAttribute("rel") ?? "",
        href: l.getAttribute("href") ?? "",
        as: l.getAttribute("as") ?? "",
      })),
    )
    .catch(() => []);

  const vitals = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let cls = 0;
        let lcp = 0;
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value;
          }).observe({ type: "layout-shift", buffered: true });
          new PerformanceObserver((list) => {
            const e = list.getEntries().at(-1);
            if (e) lcp = e.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch {
          /* a browser without these entry types reports zeroes, which read as "not measured" */
        }
        setTimeout(() => {
          const js = performance
            .getEntriesByType("resource")
            .filter((e) => e.initiatorType === "script" || /\.m?js(\?|$)/.test(e.name))
            .reduce((n, e) => n + (e.transferSize || e.encodedBodySize || 0), 0);
          resolve({ cls: +cls.toFixed(4), lcp: Math.round(lcp), js });
        }, 600);
      }),
  );
  await ctx.close();
  return { html, domLinks, fonts, tiles, firstTile, requests, ...vitals };
}

const kb = (n) => Math.round(n / 1024);
const median = (xs) => {
  const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function main() {
  const budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8"));
  const browser = await chromium.launch();
  const errs = [];
  const soft = [];
  const measured = { js: {}, requests: {}, firstTileMs: {}, lcpMs: {}, cls: {} };

  // /map and /en/map both, because the hints live in a layout under [locale]
  // and a routing change can drop them from one twin and not the other.
  for (const path of ["/map", "/en/map"]) {
    const r = await load(browser, path, { locale: path.startsWith("/en") ? "en-US" : "zh-TW" });
    const hints = checkHints(r.html, r.domLinks);
    errs.push(...hints.errs.map((e) => `${path}: ${e}`));
    soft.push(...hints.late.map((e) => `${path}: ${e}`));
    if (r.fonts.length)
      errs.push(
        `${path}: ${r.fonts.length} font request(s) — ${r.fonts[0]}. This page loads no webfont today; adding one to the map's layout delays the first paint of the heaviest page on the site.`,
      );
    const ungzipped = r.tiles.filter((t) => t.status === 200 && t.encoding !== "gzip");
    if (ungzipped.length)
      errs.push(
        `${path}: ${ungzipped.length} tile response(s) not gzipped — ${ungzipped[0].path} came back as "${ungzipped[0].encoding}". A decompressed copy in a shared cache is served to everyone after it (see #42, #43).`,
      );
    if (!r.tiles.length) errs.push(`${path}: no /api/tiles/ response at all in 9s`);
    measured.js[path] = r.js;
    measured.requests[path] = r.requests;
    measured.lcpMs[path] = r.lcp;
    measured.cls[path] = r.cls;
    console.log(
      `  ${path.padEnd(12)} js ${String(kb(r.js)).padStart(4)} KB · ${String(r.requests).padStart(3)} requests · LCP ${r.lcp}ms · CLS ${r.cls} · ${r.tiles.length} tiles · first tile ${r.firstTile ?? "never"}ms`,
    );
  }

  // First tile, three loads, median. Printed every run; a ceiling this generous
  // catches a load path that broke, not a runner having a bad minute.
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push((await load(browser, "/map")).firstTile);
  const first = median(runs);
  measured.firstTileMs["/map"] = first;
  console.log(`  first tile on /map: ${runs.map((r) => r ?? "never").join(", ")}ms — median ${first ?? "never"}ms`);
  if (first === null) errs.push("/map served no tile in three loads");
  else if (first > budget.firstTileMs.ceilingMs)
    soft.push(
      `first tile ${first}ms is over the ${budget.firstTileMs.ceilingMs}ms CI ceiling. Runner timings are noisy — check it twice before believing it, and compare against the production number in ${BUDGET_PATH}.`,
    );

  // CLS on the two pages whose content arrives in pieces.
  for (const path of ["/", "/species"]) {
    const r = await load(browser, path);
    measured.js[path] = r.js;
    measured.requests[path] = r.requests;
    measured.lcpMs[path] = r.lcp;
    measured.cls[path] = r.cls;
    console.log(
      `  ${path.padEnd(12)} js ${String(kb(r.js)).padStart(4)} KB · ${String(r.requests).padStart(3)} requests · LCP ${r.lcp}ms · CLS ${r.cls}`,
    );
    if (r.cls > budget.cls.max)
      errs.push(
        `${path}: CLS ${r.cls} is over ${budget.cls.max}. Something arrives late and pushes what is already on screen.`,
      );
  }

  await browser.close();

  if (process.env.UPDATE_PERF === "1") {
    const next = {
      ...budget,
      recordedAgainst: process.env.PERF_LABEL ?? BASE,
      recordedOn: new Date().toISOString().slice(0, 10),
      js: Object.fromEntries(Object.entries(measured.js).map(([k, v]) => [k, kb(v)])),
      requests: measured.requests,
      firstTileMs: { ...budget.firstTileMs, measuredMs: measured.firstTileMs["/map"] },
      lcpMs: measured.lcpMs,
    };
    writeFileSync(BUDGET_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(`\n  recorded -> ${BUDGET_PATH}`);
    return 0;
  }

  // Byte budgets, once somebody has recorded them.
  for (const [path, got] of Object.entries(measured.js)) {
    const allowed = budget.js[path];
    if (allowed === null || allowed === undefined) {
      soft.push(
        `no JS budget recorded for ${path} (transferred ${kb(got)} KB). Record it against a production build: UPDATE_PERF=1 TEST_BASE_URL=… node e2e/perf.spec.mjs`,
      );
      continue;
    }
    const ceiling = Math.round(allowed * (1 + budget.tolerance));
    if (kb(got) > ceiling)
      errs.push(
        `${path}: ${kb(got)} KB of JS, budget ${allowed} KB + ${Math.round(budget.tolerance * 100)}% = ${ceiling} KB.`,
      );
  }

  for (const s of soft) console.log(`  note  ${s}`);
  if (errs.length) {
    console.error("\n  the map's load path REGRESSED:");
    for (const e of errs) console.error(`    ${e}`);
    return 1;
  }
  console.log(`\n  load path intact${soft.length ? ` (${soft.length} unrecorded budget(s) — see above)` : ""}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
