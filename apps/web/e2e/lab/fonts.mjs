/**
 * How many font files each lab route actually fetches.
 *
 *   node apps/web/e2e/lab/fonts.mjs
 *   BASE=https://… node apps/web/e2e/lab/fonts.mjs
 *
 * The lab is the first thing on this site to load a web font, and the rule that
 * came with permission to do it is that the map still loads none (direction.md
 * §2.6 rule 8). That rule cannot be read off the code: `--font-display` is one
 * variable declared for the whole lab, `@font-face` blocks reach every route,
 * and whether a route pays is decided by whether anything on it is set in a
 * class above 20px. Nothing on screen says which way it went. So: count.
 *
 * Three numbers per route, and each one catches a different mistake.
 *
 *   woff2  — a face that was fetched. Non-zero on a map route is the budget
 *            broken; zero on the home page means the wiring silently stopped
 *            applying and the owner is judging a prototype set in Helvetica.
 *   KB     — which faces. The home page should be paying for `*-home` and
 *            nothing else; `*-ui` turning up there means a string moved out of
 *            the group the subsetter puts in the preload.
 *   preload — exactly one, on home only. A preload IS a fetch, so one that
 *            leaked into a layout shows up here as a map route with a font.
 *
 * Counted at two widths because a rule hidden behind `display: none` does not
 * load its font: the desktop header carries a nav the phone does not, and a
 * route can be free at 390 and not at 1440.
 *
 * Playwright sends no Accept-Language, so an unprefixed path renders zh-TW
 * (memory). Both locales are listed explicitly — and the locale matters here
 * more than usual, since /en sets Latin in the display face and zh-TW does not.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";

/**
 * `budget` is the most font files this route may fetch. Neither number is a
 * measurement; both are promises.
 *
 * 0 is the map's: direction.md §2.6 rule 8, and the reason the type scale stops
 * the display face at 28px.
 *
 * 1 is the home page's, and it is the one that will go off. The preloaded face
 * carries the chrome, the lab's home copy and the handful of live `home` keys
 * the home blocks reuse; a heading that reaches for anything else fetches a
 * second 130 KB file behind the first, on the page the owner opens outdoors on
 * a phone. The fix is a line in the subsetter, not a bigger budget.
 *
 * `atLeast` is the opposite guard: a route that should be showing off a
 * typeface and fetches nothing has silently lost its wiring, and a prototype
 * set in Helvetica is a prototype nobody can judge.
 */
const ROUTES = [
  { path: "/", name: "live home (control)", budget: 0 },
  { path: "/lab", name: "lab index", budget: 0 },
  { path: "/en/lab", name: "lab index (en)", budget: 0 },
  { path: "/lab/roundel", name: "roundel home", atLeast: 1, budget: 1 },
  { path: "/en/lab/roundel", name: "roundel home (en)", atLeast: 1, budget: 1 },
  { path: "/lab/journal", name: "journal home", atLeast: 1, budget: 1 },
  { path: "/en/lab/journal", name: "journal home (en)", atLeast: 1, budget: 1 },
  { path: "/lab/roundel/primitives", name: "roundel primitives", atLeast: 1 },
  { path: "/lab/journal/primitives", name: "journal primitives", atLeast: 1 },
  { path: "/lab/roundel/map", name: "roundel map", budget: 0 },
  { path: "/en/lab/roundel/map", name: "roundel map (en)", budget: 0 },
  { path: "/lab/journal/map", name: "journal map", budget: 0 },
];

const WIDTHS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
];

const browser = await chromium.launch();
const rows = [];
const failures = [];

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width: width.width, height: width.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const fonts = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (!/\.(woff2?|ttf|otf)(\?|$)/.test(url)) return;
      // A 404 is not a font: an href that no longer resolves would otherwise
      // read as a healthy fetch here and as a missing typeface on screen.
      fonts.push({
        file: url.split("/").pop(),
        status: response.status(),
        bytes: Number(response.headers()["content-length"] ?? 0),
      });
    });

    const response = await page.goto(BASE + route.path, {
      waitUntil: "load",
    });
    const status = response?.status() ?? 0;
    // `document.fonts.ready` settles once every face the layout needs has
    // loaded or failed, which is the moment the count is final.
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(600);

    const preloads = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="preload"][as="font"]')].map(
        (link) => link.getAttribute("href"),
      ),
    );

    const row = {
      route: route.path,
      name: route.name,
      width: width.name,
      status,
      woff2: fonts.length,
      kb: +(fonts.reduce((sum, f) => sum + f.bytes, 0) / 1024).toFixed(1),
      files: fonts.map((f) => `${f.file}${f.status === 200 ? "" : ` (${f.status})`}`),
      preloads,
    };
    rows.push(row);

    const broken = fonts.filter((f) => f.status !== 200);
    if (broken.length)
      failures.push(
        `${route.path} @${width.name}: ${broken.length} font request(s) did not return 200`,
      );
    // A route that 404s proves nothing about a budget, so it is reported and
    // not asserted — the map pages land here before their own PR does.
    if (status === 200 && route.budget !== undefined && row.woff2 > route.budget)
      failures.push(
        `${route.path} @${width.name}: ${row.woff2} font file(s), budget ${route.budget}` +
          ` — ${row.files.join(", ")}.` +
          (route.budget === 0
            ? " This route promises no web font: drop the heading to `t-lead` or" +
              ' put data-display-face="system" on its wrapper.'
            : " A string on this page is set in a heading but is not in the" +
              " preloaded face: add its key to HOME_LIVE_KEYS in" +
              " scripts/lab-subset-fonts.mjs and re-run `npm run lab:fonts`."),
      );
    if (status === 200 && route.atLeast !== undefined && row.woff2 < route.atLeast)
      failures.push(
        `${route.path} @${width.name}: fetched no font; the display face is not wired up`,
      );

    await context.close();
  }
}

await browser.close();

const pad = (value, width) => String(value).padEnd(width);
console.log(
  `${pad("route", 30)}${pad("w", 6)}${pad("HTTP", 6)}${pad("woff2", 7)}${pad("KB", 8)}files`,
);
for (const row of rows)
  console.log(
    pad(row.route, 30) +
      pad(row.width, 6) +
      pad(row.status, 6) +
      pad(row.woff2, 7) +
      pad(row.kb, 8) +
      (row.files.join(" ") || "—"),
  );

const missing = rows.filter((r) => r.status !== 200);
if (missing.length)
  console.log(
    `\nNot built yet (reported, not asserted): ${[
      ...new Set(missing.map((r) => `${r.route} ${r.status}`)),
    ].join(", ")}`,
  );

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("\nEvery route is inside its font budget.");
