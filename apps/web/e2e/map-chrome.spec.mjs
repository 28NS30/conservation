/**
 * The map's chrome tells the truth, in a real browser.
 *
 *   node e2e/map-chrome.spec.mjs
 *
 * Everything here is a claim the map makes about itself, and every one of them
 * was wrong at some point in a way no unit test could see. The legend's rule is
 * pinned in test/map-legend.test.mjs; what this adds is that the rule reaches
 * the screen — that the state the reader is actually in produces the legend the
 * rule says it should, after MapLibre has loaded tiles and moved the camera.
 *
 * Assertions read `data-legend`, ARIA and hrefs. Never classes and never
 * translated words: the legend's skin is being replaced by a later piece of
 * work, and half of these runs are in Chinese.
 *
 * Playwright sends no Accept-Language by default, so an unprefixed path renders
 * zh-TW. Both locales are visited explicitly.
 */
import { chromium } from "playwright";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const COLOUR_KEY = "conservation.mapColour";

/** The map's two locale entry points. zh-TW is unprefixed. */
const LOCALES = ["/map", "/en/map"];

const failures = [];
const browser = await chromium.launch();

function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  }
}

/**
 * Open the map with a display mode and colour already stored.
 *
 * `addInitScript` rather than clicking the toggles: the point of most of these
 * cases is what happens on FIRST paint with a preference the map cannot honour,
 * and clicking to get there would have passed through the state being tested.
 */
async function openMap(path, { mode, colour, width = 390, height = 844 }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    locale: path.startsWith("/en") ? "en-US" : "zh-TW",
  });
  await ctx.addInitScript(
    ([m, c]) => {
      try {
        localStorage.setItem("conservation.mapMode", m);
        localStorage.setItem("conservation.mapColour", c);
      } catch {
        /* private browsing; the defaults are then what is tested */
      }
    },
    [mode, colour],
  );
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: "load" });
  // The legend is server-rendered, but the camera is not, and the cases below
  // move it. NEXT_PUBLIC_E2E (or a dev build) exposes the handle.
  await page
    .waitForFunction(() => typeof window.__map?.jumpTo === "function", null, {
      timeout: 30000,
    })
    .catch(() => {
      failures.push(
        `${path}: window.__map never appeared — build with NEXT_PUBLIC_E2E=1`,
      );
    });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

/**
 * What the legend currently says about itself.
 *
 * The colour switch is found as the toggle with two buttons rather than by its
 * label, which is translated, and its buttons are read in COLOURS order —
 * density, then type — which is the order mapMode.ts declares them in.
 */
const readLegend = (page) =>
  page.evaluate((key) => {
    const card = document.querySelector("[data-legend]");
    if (!card) return null;
    const groups = [...card.querySelectorAll('[role="group"]')];
    const colour = groups.find(
      (g) => g.querySelectorAll("button").length === 2,
    );
    const [density, type] = [...(colour?.querySelectorAll("button") ?? [])].map(
      (b) => ({
        pressed: b.getAttribute("aria-pressed"),
        disabled: b.getAttribute("aria-disabled"),
        // A locked option has to say why, in something a screen reader reaches
        // and something a mouse reader reaches.
        reason: Boolean(
          b.getAttribute("title") &&
            document.getElementById(b.getAttribute("aria-describedby") ?? "")
              ?.textContent,
        ),
        focusable: !b.hasAttribute("disabled"),
      }),
    );
    return {
      kind: card.getAttribute("data-legend"),
      swatches: card.querySelectorAll("li").length,
      text: card.innerText,
      density,
      type,
      stored: localStorage.getItem(key),
    };
  }, COLOUR_KEY);

/* ---- heat: one fixed ramp, so the type option cannot apply ---- */
for (const path of LOCALES) {
  const { ctx, page } = await openMap(path, { mode: "heat", colour: "type" });
  const l = await readLegend(page);
  const at = `${path} heat+type`;
  check(`${at} shows the heat legend`, l?.kind === "heat", `got ${l?.kind}`);
  check(
    `${at} names no per-cell count`,
    !l?.text.includes("300+"),
    "a kernel density estimate has no feature count to report",
  );
  check(`${at} locks the type option`, l?.type.disabled === "true");
  check(`${at} leaves it focusable`, l?.type.focusable === true);
  check(`${at} says why it is locked`, l?.type.reason === true);
  check(`${at} shows density as the colour in use`, l?.density.pressed === "true");
  check(
    `${at} leaves the stored preference alone`,
    l?.stored === "type",
    `stored is ${l?.stored}`,
  );
  await ctx.close();
}

/* ---- individual records: always by category, whatever was stored ---- */
for (const path of LOCALES) {
  const { ctx, page } = await openMap(`${path}?lng=120.68&lat=24.14&z=15`, {
    mode: "bins",
    colour: "density",
  });
  const at = `${path} z15`;
  const l = await readLegend(page);
  check(`${at} shows the record legend`, l?.kind === "points", `got ${l?.kind}`);
  check(
    `${at} lists the four stored categories`,
    l?.swatches === 4,
    `got ${l?.swatches} swatches`,
  );
  check(
    `${at} labels no dot "300+"`,
    !l?.text.includes("300+"),
    "each dot is one record; the density classes describe cells",
  );
  check(`${at} locks the density option`, l?.density.disabled === "true");
  check(`${at} says why it is locked`, l?.density.reason === true);
  check(`${at} shows type as the colour in use`, l?.type.pressed === "true");
  check(`${at} leaves the stored preference alone`, l?.stored === "density");

  // Back out to the aggregated regime: the density classes are correct there,
  // and the stored preference must be what comes back.
  await page.evaluate(() => window.__map.jumpTo({ zoom: 10 }));
  await page.waitForTimeout(1200);
  const out = await readLegend(page);
  check(
    `${at} returns to the density legend on zooming out`,
    out?.kind === "density",
    `got ${out?.kind}`,
  );
  check(
    `${at} shows the density classes again`,
    Boolean(out?.text.includes("300+")),
    "cells really do hold 300+ reports",
  );
  check(`${at} unlocks both options`, out?.density.disabled === null && out?.type.disabled === null);
  check(
    `${at} never wrote to the colour store`,
    out?.stored === "density",
    `stored is ${out?.stored}`,
  );
  await ctx.close();
}

/* ---- the states that were already right, so they stay right ---- */
for (const path of LOCALES) {
  const { ctx, page } = await openMap(path, { mode: "bins", colour: "type" });
  const l = await readLegend(page);
  const at = `${path} bins+type`;
  check(`${at} shows the type legend`, l?.kind === "type", `got ${l?.kind}`);
  check(
    `${at} leaves both options live`,
    l?.density.disabled === null && l?.type.disabled === null,
  );
  await ctx.close();
}

/**
 * Links a person can actually see and hit.
 *
 * The map's escape hatch to the list has always existed as a skip link, which
 * `sr-only` renders as a 1px box — so "the link is in the DOM" was true the
 * whole time it was undiscoverable. Everything here is measured, and at the
 * 24x24 floor WCAG 2.5.8 sets rather than at "larger than a pixel".
 */
const visibleLinks = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("a[href]")]
      .map((a) => ({ href: a.getAttribute("href"), box: a.getBoundingClientRect() }))
      .filter(({ box }) => box.width >= 24 && box.height >= 24)
      .map(({ href }) => href),
  );

/* ---- the map and the list are two views of one question ---- */
for (const [path, list] of [
  ["/map?group=roadkill", "/reports?group=roadkill"],
  ["/en/map?group=roadkill", "/en/reports?group=roadkill"],
]) {
  const { ctx, page } = await openMap(path, { mode: "dots", colour: "density" });
  const links = await visibleLinks(page);
  check(
    `${path} offers the list where it can be seen`,
    links.includes(list),
    `visible links: ${links.join(" ")}`,
  );
  await ctx.close();
}

for (const [path, map] of [
  ["/reports?group=roadkill&page=2", "/map?group=roadkill"],
  ["/en/reports?group=roadkill&page=2", "/en/map?group=roadkill"],
]) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: path.startsWith("/en") ? "en-US" : "zh-TW",
  });
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: "load" });
  // Boxes are measured, so the stylesheet has to have arrived: `load` can fire
  // first on a cold dev compile and every link then measures as bare inline text.
  await page.waitForTimeout(2000);
  const links = await visibleLinks(page);
  check(
    `${path} offers the map, carrying the filter and not the page`,
    links.includes(map),
    `visible links: ${links.join(" ")}`,
  );
  await ctx.close();
}

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n  the map's chrome describes what the map is drawing");
