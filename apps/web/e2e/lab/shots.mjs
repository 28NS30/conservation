/**
 * The screenshot matrix the owner is actually shown.
 *
 *   node apps/web/e2e/lab/shots.mjs
 *   ONLY=home,map node apps/web/e2e/lab/shots.mjs      # re-shoot two rows
 *   BASE=https://… node apps/web/e2e/lab/shots.mjs
 *
 * Every lab route AND the live page it is a redesign of, at 1440x900 and
 * 390x844@2x, in zh-TW and in English. The output is `public/lab/shots/` plus
 * a `manifest.json` that `/lab` imports, so the compare page shows what was
 * actually shot rather than what somebody hoped had been.
 *
 * WHY TODAY'S PAGE IS SHOT FROM THE SAME SCRIPT, in the same run, on the same
 * server. A comparison assembled from screenshots taken weeks apart at whatever
 * width the person had open is not a comparison; it is two impressions. Same
 * viewport, same device pixel ratio, same database, same minute.
 *
 * WEBP IS ENCODED IN THE BROWSER. Playwright writes PNG or JPEG, and a full
 * page of forest green at 1440 is about 900 KB of PNG — forty of those is most
 * of the committed budget for a directory of throwaway pictures. Chromium is
 * already running and already has a WebP encoder, so the PNG goes back into a
 * blank page and comes out as WebP. That is one dependency (Chromium) instead
 * of two (Chromium plus whatever `cwebp` the next machine does or does not
 * have), and it makes the file sizes the same everywhere.
 *
 * MAPS ARE SHOT HEADLESS, NEVER FROM A HIDDEN BROWSER PANE. MapLibre does all
 * its work inside requestAnimationFrame, so anything that suspends rAF yields a
 * healthy basemap over a permanently empty data layer, with no error anywhere
 * (memory: "Hidden Browser pane stalls MapLibre"). The wait here is for the map
 * to say its tiles are in, not for a timer to run out.
 *
 * Playwright sends no Accept-Language, so an unprefixed path renders zh-TW
 * (memory). Both locales are therefore listed explicitly rather than assumed.
 *
 * Nothing here logs in, submits anything or reads a private endpoint: it opens
 * public URLs and photographs them.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { LAB_ROUTES, labPath } from "../../lib/lab/directions.ts";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? join(import.meta.dirname, "../../public/lab/shots");
/** 0.8 is where a 390px fold of cream and forest stops losing anything visible. */
const QUALITY = Number(process.env.QUALITY ?? 0.8);
const ONLY = (process.env.ONLY ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const LOCALES = [
  { key: "zh", locale: "zh-TW", prefix: "" },
  { key: "en", locale: "en", prefix: "/en" },
];

const VIEWPORTS = [
  { width: 1440, height: 900, scale: 1 },
  // The owner's own phone is the device this decision gets made on, so the
  // phone shot is taken at the pixel density a phone has.
  { width: 390, height: 844, scale: 2 },
];

/**
 * Which rows are worth a whole-page picture as well as a fold, and why the
 * others are not.
 *
 * Everything gets a fold: the fold trio IS the comparison, and at thumbnail
 * size it answers the one question direction.md asks of a thumbnail — whether
 * this still looks like today's site.
 *
 * Whole-page shots are the expensive half. Taken everywhere, at both widths,
 * they are 7.4 MB against 3.6 MB of folds, which is past the 5 MB this
 * directory was allowed to cost. Three things decided what to keep. A page
 * that does not scroll has no second picture to take, so the map never had
 * one. The specimen page is a developer's tool, not a page of the site, and
 * nobody is being asked to judge it. And a phone's whole page is 10,000px of
 * a 780px column: on the device this decision is made on, scrolling that image
 * is strictly worse than tapping the link beside it and scrolling the real
 * page. So the whole-page shot is the desktop one, for the three rows whose
 * argument is their rhythm rather than their first screen.
 *
 * `FULL=all` takes every one of them anyway, for anyone who wants the lot
 * locally. The committed set is the default.
 */
const FULL_ROWS = new Set(["home", "report", "species-28758"]);
const ALL_FULL = process.env.FULL === "all";

const wantsFull = (page, viewport) =>
  ALL_FULL || (viewport.width === 1440 && FULL_ROWS.has(page));

/**
 * A page of the site, and every version of it there is to look at.
 *
 * Built from `LAB_ROUTES` rather than typed out again, so a route added to the
 * lab turns up here on its own and a route removed stops being shot. `page` is
 * the grouping key the compare page lays its rows out by; `variant` is the
 * column within a row and is also what names the file.
 *
 * Two rows are not one route each. The two report flows are two answers to the
 * same question, so they share a row and today's form is the one column they
 * are both measured against — shooting `/report` twice would put the same
 * picture in the comparison twice and imply there are two of it. And the
 * specimen page has no column of today's at all: it is not a page of the site,
 * it is how a theme change gets checked.
 */
function matrix() {
  const groups = new Map();
  const seen = new Set();
  const push = (page, entry) => {
    if (!groups.has(page)) groups.set(page, []);
    groups.get(page).push(entry);
  };

  for (const route of LAB_ROUTES) {
    const flow = route.sub.startsWith("/report/")
      ? route.sub.slice("/report/".length)
      : null;
    const page =
      route.sub === ""
        ? "home"
        : flow
          ? "report"
          : route.sub.slice(1).replace(/\//g, "-");

    // Today's page first: it is the column everything else is being measured
    // against, and a reader's eye starts at the left.
    if (page !== "primitives" && !seen.has(`${page}|today`)) {
      seen.add(`${page}|today`);
      push(page, { variant: "today", direction: null, flow: null, href: route.live });
    }
    if (!route.built) continue;
    for (const direction of route.directions) {
      const variant = flow ? `${direction}-${flow}` : direction;
      if (seen.has(`${page}|${variant}`)) continue;
      seen.add(`${page}|${variant}`);
      push(page, {
        variant,
        direction,
        flow,
        href: labPath(direction, route.sub),
      });
    }
  }
  return [...groups.entries()].map(([page, shots]) => ({ page, shots }));
}

/* ---- the browser ------------------------------------------------------- */

mkdirSync(OUT, { recursive: true });
const rows = matrix().filter(({ page }) => !ONLY.length || ONLY.includes(page));

// A stale shot is worse than a missing one: it is a picture of a design nobody
// is proposing any more, sitting in a comparison the owner is trusting. A full
// run clears the directory; a filtered one clears only the rows it is redoing.
for (const name of readdirSync(OUT, { withFileTypes: true })) {
  if (!name.isFile() || !name.name.endsWith(".webp")) continue;
  if (ONLY.length && !rows.some(({ page }) => name.name.startsWith(`${page}-`)))
    continue;
  rmSync(join(OUT, name.name));
}

const browser = await chromium.launch();
/** One blank tab, kept open, used only as a WebP encoder. */
const encoder = await (await browser.newContext()).newPage();

async function toWebp(png) {
  const encoded = await encoder.evaluate(
    async ([data, quality]) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: "image/webp", quality });
      const out = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < out.length; i += 0x8000)
        binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return { data: btoa(binary), width: bitmap.width, height: bitmap.height };
    },
    [png.toString("base64"), QUALITY],
  );
  return {
    buffer: Buffer.from(encoded.data, "base64"),
    width: encoded.width,
    height: encoded.height,
  };
}

/**
 * Everything that has to settle before a page is worth photographing.
 *
 * Returns how many features the map has actually drawn, or `null` for a page
 * with no map on it. That number is the only honest answer to "is this picture
 * of a map": the first shot this script ever took came back as a perfectly
 * composed page with an empty rectangle where Taiwan should be, because on a
 * cold dev server the style had not arrived before the wait ran out. Nothing
 * about that file says it is wrong — it is the right size, it has the right
 * chrome, and it would have gone into the comparison as "today's map".
 */
async function settle(page) {
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  const hasMap = await page.evaluate(() =>
    Boolean(document.querySelector(".maplibregl-map")),
  );
  if (!hasMap) {
    await page.waitForTimeout(700);
    await page.evaluate(() => window.scrollTo(0, 0));
    return null;
  }

  await page
    .waitForFunction(
      () => {
        const map = window.__labMap ?? window.__map;
        return Boolean(
          map &&
            map.isStyleLoaded() &&
            map.areTilesLoaded() &&
            map.queryRenderedFeatures().length > 0,
        );
      },
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  // Tiles reported in is not the same as tiles drawn: the label layers are
  // placed one frame later, and a shot taken on the frame `idle` fires has no
  // place names on it at all.
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate(() => {
    const map = window.__labMap ?? window.__map;
    return map ? map.queryRenderedFeatures().length : 0;
  });
}

/**
 * Two things that are on screen and are not the design.
 *
 * THE DEV SERVER'S OWN BADGE. `next dev` draws a round N in the bottom-left
 * corner, over the phone tab bar, on every route including today's. It does not
 * exist in a production build. Left in, it would sit in the corner of ninety-six
 * pictures looking like something one of the designs put there.
 *
 * THE LAB'S COMPARE STRIP. It is scaffolding — which direction is on screen,
 * how to get to the other one — and `base.css` says in as many words that it is
 * deliberately not themed so that nobody reads it as part of the design. At 390
 * it wraps to three lines and takes 240px of an 844px fold, which no live page
 * pays. Judging a thumbnail with it in is judging the scaffolding, and worse,
 * it is judging Roundel and Field journal against a version of today's page
 * that was never charged for it.
 *
 * Neither is hidden on the real route: the owner tapping through from the
 * compare page gets the strip, because that is how they get back. `STRIP=keep`
 * puts it in the pictures too, for anyone who wants to see what the whole
 * screen looks like.
 */
const HIDE = [
  "nextjs-portal { display: none !important }",
  process.env.STRIP === "keep" ? "" : ".lab-strip { display: none !important }",
].join("\n");

const manifest = [];
const problems = [];

for (const { page: pageKey, shots } of rows) {
  for (const shot of shots) {
    for (const locale of LOCALES) {
      for (const viewport of VIEWPORTS) {
        const url = BASE + locale.prefix + shot.href;
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.scale,
        });
        // An init script rather than `addStyleTag`, so the rules survive the
        // reload the blank-map guard below may do.
        await context.addInitScript((css) => {
          const inject = () => {
            const style = document.createElement("style");
            style.textContent = css;
            document.head.append(style);
          };
          if (document.head) inject();
          else document.addEventListener("DOMContentLoaded", inject, { once: true });
        }, HIDE);

        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message.slice(0, 160)));

        const response = await page.goto(url, { waitUntil: "load" });
        const status = response?.status() ?? 0;
        if (status !== 200) {
          problems.push(`${url} answered ${status}`);
          await context.close();
          continue;
        }
        // One reload, then give up and say so. A blank map is nearly always the
        // dev server compiling the route for the first time, and it is the one
        // failure that looks like a finished picture.
        let features = await settle(page);
        if (features === 0) {
          await page.reload({ waitUntil: "load" });
          features = await settle(page);
        }
        if (features === 0) problems.push(`${url} drew an empty map`);

        const height = await page.evaluate(
          () => document.documentElement.scrollHeight,
        );
        const cuts = ["fold"];
        // A page that does not scroll has no second picture to take: a "full"
        // shot of the map route is the fold shot again, at twice the bytes.
        if (height > viewport.height + 8 && wantsFull(pageKey, viewport))
          cuts.push("full");

        for (const cut of cuts) {
          const png = await page.screenshot({ fullPage: cut === "full" });
          const webp = await toWebp(png);
          const file = `${pageKey}-${shot.variant}-${locale.key}-${viewport.width}-${cut}.webp`;
          writeFileSync(join(OUT, file), webp.buffer);
          manifest.push({
            file,
            page: pageKey,
            variant: shot.variant,
            direction: shot.direction,
            flow: shot.flow,
            locale: locale.locale,
            viewport: viewport.width,
            cut,
            // Unprefixed: the compare page links with next-intl's `Link`, which
            // adds the locale itself. A prefixed href here would give /en/en/….
            href: shot.href,
            width: webp.width,
            height: webp.height,
            bytes: webp.buffer.length,
          });
        }
        if (errors.length) problems.push(`${url}: ${errors[0]}`);
        await context.close();
      }
    }
  }
}

await browser.close();

manifest.sort((a, b) => a.file.localeCompare(b.file));
const total = manifest.reduce((sum, shot) => sum + shot.bytes, 0);
writeFileSync(
  join(OUT, "manifest.json"),
  `${JSON.stringify({ base: BASE, quality: QUALITY, shots: manifest }, null, 2)}\n`,
);

const pad = (value, width) => String(value).padEnd(width);
console.log(`${pad("file", 42)}${pad("px", 12)}KB`);
for (const shot of manifest)
  console.log(
    pad(shot.file, 42) +
      pad(`${shot.width}x${shot.height}`, 12) +
      (shot.bytes / 1024).toFixed(0),
  );
console.log(
  `\n${manifest.length} shots, ${(total / 1024 / 1024).toFixed(2)} MB total.`,
);

if (problems.length) {
  console.error(`\n${problems.length} problem(s) while shooting:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
