/**
 * The four things a prototype can be wrong about without anybody noticing.
 *
 *   node apps/web/e2e/lab/checks.mjs
 *   ONLY=/lab/roundel/map node apps/web/e2e/lab/checks.mjs
 *   BASE=https://… node apps/web/e2e/lab/checks.mjs
 *
 * Every lab route, in both locales, reporting:
 *
 *   axe        — the violations axe-core finds at 390 and at 1440. A phone
 *                carries a tab bar a desktop does not, so the two widths are
 *                genuinely two documents.
 *   type size  — any text under 14px. direction.md §2.6 rule 5 is "no Hanzi
 *                under 14px", and today's site breaks it in four places; a
 *                redesign that quietly reintroduces a 12px label has lost the
 *                argument it was making.
 *   overflow   — anything sticking out past the viewport at 320, 360 and 390.
 *                320 is not a phone anybody sells; it is the width a 390px
 *                phone becomes when its owner turns on larger text.
 *   contrast   — every piece of text on the ground it is actually drawn on,
 *                composited through however many translucent ancestors there
 *                are, against WCAG 2.x AA. Reports the floor per route, which
 *                is the number that decides whether a page survives sunlight.
 *
 * WHY MEASURE WHAT THE THEME FILES ALREADY ASSERT. `test/lab.test.mjs` checks
 * the ramps by reading the hexes out of the CSS, which proves the palette is
 * sound and proves nothing at all about the page: a token is only as good as
 * the element that ends up wearing it, and the failure mode is a Tailwind class
 * naming a token that does not exist, which emits no CSS and no warning. This
 * reads the computed style off the rendered document instead.
 *
 * EXEMPTIONS ARE PRINTED, NEVER HIDDEN. Two kinds of small text are allowed and
 * both are named in `EXEMPT` below with the reason. They are counted and shown
 * in the output, so an exemption that starts covering something it was never
 * meant to is visible rather than silent.
 *
 * Playwright sends no Accept-Language, so an unprefixed path renders zh-TW
 * (memory). Both locales are listed explicitly.
 *
 * Exit status is 1 if anything failed, so this can gate a pull request.
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";

import { LAB_ROUTES, labPath } from "../../lib/lab/directions.ts";

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve("axe-core").replace(/axe\.js$/, "axe.min.js");

const BASE = process.env.BASE ?? "http://localhost:3000";
const ONLY = (process.env.ONLY ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

/**
 * Every route the lab serves, plus the three screens no route reaches on its
 * own. A receipt is a whole page — an emblem, a heading, a status line and two
 * signs — that exists only after a form is sent, and a design nobody audited
 * because it was three clicks in is exactly the kind of gap this file is for.
 */
const PATHS = [
  "/lab",
  ...LAB_ROUTES.flatMap((route) =>
    route.built ? route.directions.map((d) => labPath(d, route.sub)) : [],
  ),
  ...["published", "held", "queued"].map(
    (receipt) => `/lab/roundel/report/stepper?receipt=${receipt}`,
  ),
];

const LOCALES = ["", "/en"];

/**
 * 320, 360 and 390 are checked for overflow only, and are cheap: no axe, no
 * map wait. 390 and 1440 are the two real documents and get everything.
 */
const WIDTHS = [
  { width: 320, height: 800, full: false },
  { width: 360, height: 800, full: false },
  { width: 390, height: 844, full: true },
  { width: 1440, height: 900, full: true },
];

/** The floor, in px. Hanzi below this is unreadable on a phone held at arm's length. */
const MIN_TEXT = 14;

/**
 * The only two kinds of text allowed under the floor, and why.
 *
 * Neither is a loophole for "this label did not fit". Both are checked by what
 * the element IS, not by where it happens to be on the page.
 */
const EXEMPT = [
  {
    id: "status-glyph",
    why: "direction.md §2.5: a StatusTag's ▲ ● ■ ◐ is geometry, not type. It is aria-hidden, it carries no language, and the word beside it is at 14px.",
  },
  {
    id: "maplibre-chrome",
    why: "MapLibre draws its own attribution and scale bar at 12px. It is library chrome, it is identical on today's /map, and the OSM attribution may not be restyled away.",
  },
];

/* ---- the audit, run inside the page ------------------------------------ */

/**
 * Written as one function passed to `evaluate` rather than as several, because
 * every part of it needs the same colour cache and the same walk of the
 * document, and doing the walk three times on the specimen page is three times
 * the work for the same answer.
 */
function auditInPage(minText) {
  /** ▲ ● ■ ◐ — the four StatusTag glyphs and nothing else. */
  const GLYPHS = /^[▲●■◐\s]+$/;

  const cache = new Map();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  /**
   * Any CSS colour to {r,g,b,a}, by painting it.
   *
   * Parsing the string would have to cover `rgb()`, `rgba()`, `color(srgb …)`
   * and whatever `color-mix()` computes to this month — and `color-mix` is how
   * this lab draws every quiet rule. Painting one pixel is the browser's own
   * answer to the question, whatever the syntax.
   */
  const toRGBA = (value) => {
    if (cache.has(value)) return cache.get(value);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const out = { r, g, b, a: a / 255 };
    cache.set(value, out);
    return out;
  };

  const over = (fg, bg) => {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (x, y) => (x * fg.a + y * bg.a * (1 - fg.a)) / a;
    return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
  };

  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const where = (el) => {
    const parts = [];
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const cls = (node.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter((c) => c && !c.includes("("))
        .slice(0, 2)
        .join(".");
      parts.unshift(node.tagName.toLowerCase() + (cls ? `.${cls}` : ""));
      if (parts.length >= 3) break;
    }
    return parts.join(" > ");
  };

  const directText = (el) => {
    let text = "";
    for (const node of el.childNodes)
      if (node.nodeType === 3) text += node.nodeValue;
    return text.trim();
  };

  const small = [];
  const exempt = [];
  const contrast = [];
  const unknownGround = [];
  let floor = Infinity;
  let floorAt = null;
  let checked = 0;

  for (const el of document.querySelectorAll("body *")) {
    const text = directText(el);
    if (!text) continue;
    const rect = el.getBoundingClientRect();
    // A screen-reader-only string is clipped to a pixel. It is read aloud, not
    // drawn, so neither its size nor its contrast is a fact about the page.
    if (rect.width <= 1 || rect.height <= 1) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden") continue;

    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;

    if (size < minText - 0.005) {
      const row = {
        at: where(el),
        size: +size.toFixed(1),
        text: text.slice(0, 40),
      };
      if (GLYPHS.test(text)) exempt.push({ ...row, id: "status-glyph" });
      else if (el.closest(".maplibregl-ctrl, .maplibregl-canvas-container"))
        exempt.push({ ...row, id: "maplibre-chrome" });
      else small.push(row);
    }

    // The ground, composited from the outside in: an opaque white base, then
    // every ancestor's background over it in painting order, then the element's
    // own. A single ancestor lookup would read `transparent` and call it white.
    const chain = [];
    let opacity = 1;
    let painted = null;
    for (let node = el; node; node = node.parentElement) {
      const cs = node === el ? style : getComputedStyle(node);
      opacity *= Number(cs.opacity);
      if (cs.backgroundImage !== "none") painted = where(node);
      chain.push(cs.backgroundColor);
    }
    // Nothing is drawn at zero opacity, so there is no contrast to measure.
    // MapLibre's cooperative-gesture overlay — "Use ⌘ + scroll to zoom the map"
    // — lives permanently in the DOM at opacity 0 and appears only while two
    // fingers are on the map. Counting it reported a 1.00:1 floor on every
    // page with an embedded map, which buries the number that matters.
    if (opacity === 0) continue;
    let ground = { r: 255, g: 255, b: 255, a: 1 };
    for (const colour of chain.reverse()) ground = over(toRGBA(colour), ground);

    if (painted) {
      unknownGround.push({ at: where(el), behind: painted });
      continue;
    }

    const fg = toRGBA(style.color);
    // Opacity on an ancestor fades the text towards its own ground, which is
    // the same arithmetic as a translucent text colour.
    const drawn = over({ ...fg, a: fg.a * opacity }, ground);
    const found = ratio(drawn, ground);
    checked += 1;
    if (found < floor) {
      floor = found;
      floorAt = { at: where(el), text: text.slice(0, 30), size: +size.toFixed(1) };
    }

    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    if (found + 0.005 < need)
      contrast.push({
        at: where(el),
        text: text.slice(0, 40),
        size: +size.toFixed(1),
        weight,
        ratio: +found.toFixed(2),
        need,
      });
  }

  /* ---- overflow ---- */
  const viewport = document.documentElement.clientWidth;
  const scrollWidth = document.documentElement.scrollWidth;
  const offenders = [];
  if (scrollWidth > viewport + 1)
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= viewport + 1 && rect.left >= -1) continue;
      // Something inside a box that scrolls sideways on purpose is not the
      // page overflowing; it is the box doing its job.
      let clipped = false;
      for (let node = el.parentElement; node; node = node.parentElement)
        if (!/visible/.test(getComputedStyle(node).overflowX)) {
          clipped = true;
          break;
        }
      if (clipped) continue;
      offenders.push({
        at: where(el),
        right: Math.round(rect.right),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        text: (el.textContent ?? "").trim().slice(0, 30),
      });
    }

  return {
    small,
    exempt,
    contrast,
    unknownGround,
    checked,
    floor: floor === Infinity ? null : +floor.toFixed(2),
    floorAt,
    overflow: {
      viewport,
      scrollWidth,
      // The outermost offenders are the cause; the rest are their children.
      offenders: offenders.slice(0, 6),
    },
  };
}

/* ---- the run ----------------------------------------------------------- */

async function settle(page) {
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  const hasMap = await page.evaluate(() =>
    Boolean(document.querySelector(".maplibregl-map")),
  );
  if (!hasMap) {
    await page.waitForTimeout(500);
    return;
  }
  await page
    .waitForFunction(
      () => {
        const map = window.__labMap ?? window.__map;
        return Boolean(map && map.isStyleLoaded() && map.areTilesLoaded());
      },
      null,
      { timeout: 25000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1000);
}

const browser = await chromium.launch();
const rows = [];
const failures = [];

// A prefix, but only at a path boundary: bare `startsWith` made `ONLY=/lab`
// match every route in the lab rather than the compare page it names.
const wanted = (path) =>
  !ONLY.length ||
  ONLY.some(
    (only) =>
      path === only ||
      path.startsWith(`${only}/`) ||
      path.startsWith(`${only}?`),
  );

for (const path of PATHS) {
  if (!wanted(path)) continue;
  for (const prefix of LOCALES) {
    const url = BASE + prefix + path;
    for (const size of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 1,
      });
      // The dev server's own error-overlay badge is a fixed-position circle in
      // the corner of every route and does not exist in a production build.
      // Left in, it is an axe node and an overflow candidate that no deployed
      // page has.
      await context.addInitScript(() => {
        const inject = () => {
          const style = document.createElement("style");
          style.textContent = "nextjs-portal { display: none !important }";
          document.head.append(style);
        };
        if (document.head) inject();
        else document.addEventListener("DOMContentLoaded", inject, { once: true });
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 160)));

      const response = await page.goto(url, { waitUntil: "load" });
      const status = response?.status() ?? 0;
      if (status !== 200) {
        failures.push(`${url} @${size.width}: HTTP ${status}`);
        await context.close();
        continue;
      }
      // A page that only has to answer "does anything stick out" does not need
      // its tiles; a page that is being audited does.
      if (size.full) await settle(page);
      else await page.waitForTimeout(600);

      const audit = await page.evaluate(auditInPage, MIN_TEXT);

      let violations = [];
      if (size.full) {
        await page.addScriptTag({ path: AXE_PATH });
        const result = await page.evaluate(async () => {
          const run = await window.axe.run(document, {
            resultTypes: ["violations"],
          });
          return run.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            nodes: violation.nodes.length,
            where: violation.nodes
              .slice(0, 3)
              .map((node) => node.target.join(" "))
              .join(" | "),
          }));
        });
        violations = result;
      }

      const row = {
        url: prefix + path,
        width: size.width,
        axe: size.full ? violations.length : null,
        axeDetail: violations,
        small: audit.small,
        exempt: audit.exempt,
        contrast: audit.contrast,
        unknownGround: audit.unknownGround,
        checked: audit.checked,
        floor: audit.floor,
        floorAt: audit.floorAt,
        overflow: audit.overflow,
        pageErrors,
      };
      rows.push(row);

      const at = `${prefix || "/(zh-TW)"}${path} @${size.width}`;
      for (const violation of violations)
        failures.push(
          `${at}: axe ${violation.id} (${violation.impact}, ${violation.nodes} node(s)) — ${violation.help} [${violation.where}]`,
        );
      for (const item of audit.small)
        failures.push(
          `${at}: ${item.size}px text "${item.text}" at ${item.at} — the floor is ${MIN_TEXT}px`,
        );
      if (audit.overflow.offenders.length || audit.overflow.scrollWidth > audit.overflow.viewport + 1)
        failures.push(
          `${at}: document is ${audit.overflow.scrollWidth}px wide in a ${audit.overflow.viewport}px viewport` +
            (audit.overflow.offenders.length
              ? ` — ${audit.overflow.offenders
                  .map((o) => `${o.at} (${o.left}…${o.right})`)
                  .join(", ")}`
              : " (no single element is out; a min-width or a negative margin)"),
        );
      for (const item of audit.contrast)
        failures.push(
          `${at}: ${item.ratio}:1 on "${item.text}" (${item.size}px/${item.weight}) at ${item.at} — needs ${item.need}`,
        );
      for (const item of audit.unknownGround)
        failures.push(
          `${at}: ${item.at} sits on a background image at ${item.behind}; its contrast cannot be computed`,
        );
      for (const error of pageErrors) failures.push(`${at}: page error — ${error}`);

      await context.close();
    }
  }
}

await browser.close();

/* ---- the report -------------------------------------------------------- */

const pad = (value, width) => String(value ?? "—").padEnd(width);
console.log(
  pad("route", 44) +
    pad("w", 6) +
    pad("axe", 5) +
    pad("<14", 5) +
    pad("over", 6) +
    pad("!AA", 5) +
    pad("floor", 7) +
    "lowest",
);
for (const row of rows)
  console.log(
    pad(row.url, 44) +
      pad(row.width, 6) +
      pad(row.axe, 5) +
      pad(row.small.length, 5) +
      pad(row.overflow.scrollWidth > row.overflow.viewport + 1 ? "YES" : "no", 6) +
      pad(row.contrast.length, 5) +
      pad(row.floor, 7) +
      (row.floorAt ? `${row.floorAt.text} (${row.floorAt.size}px)` : ""),
  );

const floors = rows.map((row) => row.floor).filter((floor) => floor !== null);
const exemptions = rows.flatMap((row) => row.exempt);
const byId = new Map();
for (const item of exemptions) byId.set(item.id, (byId.get(item.id) ?? 0) + 1);

console.log(
  `\n${rows.length} route/width pairs, ${rows.reduce((sum, row) => sum + row.checked, 0)} text nodes measured.`,
);
console.log(`Contrast floor across the lab: ${Math.min(...floors).toFixed(2)}:1.`);
console.log("\nSmall text allowed, and why:");
for (const rule of EXEMPT)
  console.log(`  ${pad(rule.id, 18)}${byId.get(rule.id) ?? 0} occurrence(s) — ${rule.why}`);

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("\nEvery lab route is clean: no axe violations, nothing under 14px,");
console.log("nothing overflowing at 320, and every foreground clears AA on its ground.");
