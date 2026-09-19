/**
 * Nothing may scroll sideways on a phone.
 *
 *   node e2e/reflow.spec.mjs
 *   ONLY=stats,species node e2e/reflow.spec.mjs
 *
 * `checkWidths()` lifted out of pages.spec.mjs, where #48 wrote it and aimed it
 * at four routes it had reason to suspect. The reasoning applies to all of them,
 * and the four were chosen by knowing where the bug was — which is not a method
 * that finds the next one. Here it runs over the whole route table in both
 * locales. The function is exported so pages.spec.mjs can call this copy rather
 * than keep its own; see docs/qa-harness.md, "Migrating pages.spec.mjs".
 *
 * Why it matters, in #48's words: horizontal overflow is invisible on a laptop
 * and unusable on a handset — the reader drags the page left to read the end of
 * a line and everything else goes with it. It is also silent: no error, no
 * warning, the page returns 200. It was live on two English pages, which is the
 * other half of the point. These widths are checked in English as well as
 * Chinese because a Latin binomial is two or three times the width of the
 * Chinese name beside it, so the Chinese pages were clean while /en/stats laid
 * out 421px inside a 390px viewport.
 *
 * 320px is the WCAG 1.4.10 reflow width: not a phone anybody sells, but what a
 * 390px phone becomes when its owner turns on larger text.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import {
  BASE,
  LOCALES,
  REFLOW_WIDTHS,
  pathFor,
  resolveIds,
  routesFor,
} from "./routes.mjs";

/**
 * @param page      a Playwright page already loaded at the route
 * @param widths    viewport widths to sweep
 * @param restore   viewport to leave the page at, for callers that keep using it
 */
export async function checkWidths(
  page,
  widths = REFLOW_WIDTHS,
  restore = { width: 1000, height: 800 },
) {
  const errs = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      if (doc.scrollWidth <= innerWidth) return null;
      // Name what is actually sticking out, or the failure is a number with
      // nowhere to start looking. The widest element first — an overflowing
      // child inside an overflowing parent lists both, and the one that is
      // wrong is usually the deepest node at the furthest right edge.
      const clipped = (el) => {
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const ox = getComputedStyle(n).overflowX;
          if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip")
            return true;
        }
        return false;
      };
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right <= innerWidth + 1) continue;
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        // An element scrolling inside itself is how a wide table is SUPPOSED to
        // behave; it is the DOCUMENT scrolling that hurts, and a child inside a
        // scroller cannot cause that. Asked of the computed style rather than
        // of a class name: Tailwind's `overflow-x-auto`, a `<pre>`, a utility
        // someone writes next year and MapLibre's own containers all answer the
        // same question, and none of them has to be listed here.
        if (clipped(el)) continue;
        const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".");
        out.push({
          right: Math.round(r.right),
          width: Math.round(r.width),
          at: el.tagName.toLowerCase() + (cls ? `.${cls}` : ""),
          text: (el.textContent ?? "").trim().slice(0, 28),
        });
      }
      out.sort((a, b) => b.right - a.right);
      return { sw: doc.scrollWidth, iw: innerWidth, worst: out.slice(0, 3) };
    });
    if (m) {
      const worst = m.worst.length
        ? m.worst
            .map((c) => `${c.at} reaches ${c.right}px ("${c.text}")`)
            .join("; ")
        : "no element sticks out — the overflow is a margin, a shadow or a transform";
      errs.push(`scrolls sideways at ${w}px: ${m.sw} > ${m.iw} — ${worst}`);
    }
  }
  if (restore) await page.setViewportSize(restore);
  return errs;
}

async function main() {
  const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const { ids, notes } = await resolveIds();
  for (const n of notes) console.log(`  id   ${n}`);
  const { run, skipped } = routesFor("reflow", ids);
  const routes = only.length ? run.filter((r) => only.includes(r.name)) : run;
  for (const s of skipped) console.log(`  skip ${s.name}: ${s.why}`);

  const browser = await chromium.launch();
  const failures = [];
  let checked = 0;
  for (const route of routes) {
    for (const locale of LOCALES) {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: locale.locale,
      });
      const page = await ctx.newPage();
      const path = pathFor(route, locale, ids);
      // The status is the point, not a nicety. Swallowing it meant a route that
      // 500s, or a server that is not running at all, was measured as a clean
      // page and reported "ok" — a sweep that cannot tell "no problems" from
      // "no page" is worse than no sweep, because it is believed. `expectStatus`
      // was already declared in routes.mjs for the 404 row and read by nothing.
      const res = await page.goto(BASE + path, { waitUntil: "load" }).catch(() => null);
      const want = route.expectStatus ?? 200;
      if (!res || res.status() !== want) {
        failures.push({
          path,
          errs: [`expected HTTP ${want}, got ${res ? res.status() : "no response"}`],
        });
        continue;
      }
      await page.waitForTimeout(route.settle ?? 2500);
      const errs = await checkWidths(page, REFLOW_WIDTHS, null);
      checked += REFLOW_WIDTHS.length;
      if (errs.length) failures.push({ path, errs });
      console.log(`  ${errs.length ? "FAIL" : "ok  "} ${path}`);
      await ctx.close();
    }
  }
  await browser.close();

  if (failures.length) {
    console.error("\n" + JSON.stringify(failures, null, 2));
    console.error(`\n  ${failures.length} page(s) scroll sideways`);
    return 1;
  }
  console.log(`\n  no sideways scroll in ${checked} page/width combinations`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
