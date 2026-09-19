/**
 * WCAG AA contrast, measured on the rendered page, with an exit code.
 *
 *   node e2e/contrast.spec.mjs
 *   ONLY=map,home node e2e/contrast.spec.mjs
 *   UPDATE_CONTRAST=1 node e2e/contrast.spec.mjs   # re-record the known issues
 *
 * This is `_contrast.mjs` promoted. The measuring was sound and is kept almost
 * verbatim — every comment below that explains a past mistake is describing one
 * this file already made and fixed, and deleting the comment is how it comes
 * back. What changed is everything around the measurement:
 *
 *   it ran nowhere        — CI never called it, so `dark-tokens-on-light` shipped
 *                           while a file that would have caught it sat in the tree
 *   it printed            — no exit code, so it could not gate anything
 *   it knew 8 paths       — hand-copied from an older list; /login, /team,
 *                           /season and /reports/[id] were never measured
 *   zh only, one width    — English pages lay out differently and were unmeasured
 *   two hardcoded colours — the page floor [250,247,240] and the map ground
 *                           [11,20,16]. Both are now read from the DOM, so a new
 *                           palette moves them instead of skewing the audit
 *                           silently.
 *
 * Contrast is the one part of a design that cannot be judged by eye:
 * parchment-500 looked right in every screenshot here and measures 4.05:1.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, LOCALES, ROUTES, pathFor, resolveIds, routesFor } from "./routes.mjs";

/** The phone and the laptop. A page is two different documents at these widths. */
export const CONTRAST_WIDTHS = [390, 1440];

const KNOWN_PATH = join(import.meta.dirname, "contrast-known.json");

/**
 * The audit, run inside the page.
 *
 * Exported so it can be aimed at a fixture as well as at the site:
 * `test/qa-harness.test.mjs` serves a page whose chip is black on near-black
 * and checks that this returns it. A contrast auditor nobody audits is a
 * contrast auditor that reports "clean" forever.
 */
export async function auditContrast(page) {
  return page.evaluate(() => {
    const lum = (c) => {
      const [r, g, bb] = c.map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bb;
    };
    // Resolve through a canvas: computed styles come back as lab()/oklab() for
    // any colour Tailwind built with an opacity modifier, and pulling three
    // numbers out of those with a regex yields nonsense — which is exactly how
    // the first run of this produced six phantom failures.
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const parse = (s) => {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "#000";
      cx.fillStyle = s;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const hex = (c) =>
      "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
    /*
     * Alpha, counted properly rather than by grabbing the last number.
     *
     * The previous regex read the trailing value of any colour, so opaque
     * `rgb(207, 114, 56)` came back as alpha 56. That was invisible while the
     * result was only compared against a threshold — 56 >= 0.75 is "opaque",
     * accidentally right — and produced negative contrast ratios the moment it
     * was used as a multiplier.
     */
    const alphaOf = (s) => {
      const nums = (s.match(/[\d.]+/g) || []).map(Number);
      if (/^rgba/.test(s) || /\//.test(s)) {
        return nums.length >= 4 ? nums[3] : 1;
      }
      return 1;
    };

    /*
     * The page's own surface, asked of the page.
     *
     * This was the literal [250,247,240] — paper-50 as it stood in September.
     * A palette change would have moved every real background and left the
     * floor where it was, and the audit would have gone on reporting ratios
     * against a colour no longer on screen. `body` is the element the floor
     * actually is.
     */
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const FLOOR =
      bodyBg && alphaOf(bodyBg) > 0 ? parse(bodyBg) : [255, 255, 255];

    /*
     * The dark ground under map chrome, also asked of the page.
     *
     * The map is a WebGL canvas, not a background colour, so the DOM cannot say
     * what is behind the legend and the mode toggle laid over it. A marker says
     * instead: `data-on-dark` today (SiteHeader.tsx), `.on-dark`, and `.on-field`
     * which W2 renames it to — all three accepted, so the audit keeps working
     * across that rename instead of measuring overlay text against the light
     * page behind it and inventing three failures.
     *
     * The colour itself comes from the element: `--ground` if the marker sets
     * one, else the `--color-bark-950` token, which is the ground the basemap
     * is styled to. Only if neither exists does it fall back to a literal.
     */
    const groundOf = (el) => {
      const cs = getComputedStyle(el);
      for (const prop of ["--ground", "--color-bark-950"]) {
        const v = cs.getPropertyValue(prop).trim();
        if (v) return parse(v);
      }
      return [11, 20, 16];
    };
    const MARKED = "[data-on-dark], .on-dark, .on-field";

    /*
     * Composite the background the way the browser does, instead of hunting for
     * the first layer opaque enough to count.
     *
     * The old version took any layer at 75% or more and ignored the rest. That
     * is two errors in opposite directions: a 70% panel over the dark map was
     * skipped entirely, so its text was measured against the light page behind
     * and reported as a failure it was not; and a 76% panel was treated as
     * fully opaque, overstating contrast slightly. The threshold was a guess
     * standing in for arithmetic.
     */
    const bgOf = (el) => {
      const layers = [];
      let floor = FLOOR;
      for (let n = el; n; n = n.parentElement) {
        if (n.matches && n.matches(MARKED)) {
          floor = groundOf(n);
          break;
        }
        const bg = getComputedStyle(n).backgroundColor;
        if (!bg || bg === "transparent") continue;
        const a = alphaOf(bg);
        if (a <= 0) continue;
        layers.push([parse(bg), a]);
        if (a >= 0.999) return composite(layers, floor);
      }
      return composite(layers, floor);
    };
    function composite(layers, floor) {
      let [r, g, b] = floor;
      for (let i = layers.length - 1; i >= 0; i--) {
        const [c, a] = layers[i];
        r = c[0] * a + r * (1 - a);
        g = c[1] * a + g * (1 - a);
        b = c[2] * a + b * (1 - a);
      }
      return [r, g, b];
    }

    const out = [];
    for (const el of document.querySelectorAll(
      "p,span,a,h1,h2,h3,h4,li,dt,dd,button,label,td,th,figcaption,summary",
    )) {
      /*
       * Measure an element's OWN text nodes, not its subtree.
       *
       * This used to skip anything with element children, which silently
       * excluded every button that pairs a label with an icon — the report
       * form's category chips among them. One of those was shipping black on
       * near-black, a ratio of 1.06, and this audit reported the page clean.
       */
      const txt = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join("")
        .trim();
      if (!txt) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.opacity === "0") continue;
      const fg = parse(cs.color),
        bg = bgOf(el);
      const L1 = lum(fg),
        L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const px = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = px >= 24 || (px >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      if (ratio + 0.005 < need)
        out.push({
          t: txt.slice(0, 22),
          fg: hex(fg),
          bg: hex(bg),
          px: Math.round(px),
          bold,
          ratio: +ratio.toFixed(2),
          need,
        });
    }
    return out;
  });
}

/** What a failure is, stripped of anything a copy edit would change. */
export const signature = (r) => `${r.fg} on ${r.bg} @${r.px}px${r.bold ? " bold" : ""}`;

/**
 * Compare today against the recorded list.
 *
 * A signature that is not in the list at all, or that now appears on more
 * screens than it did, is a regression and fails. Fewer is progress: it passes,
 * and says which line to lower. Exported for the self-test, which is the only
 * way to prove a ratchet ratchets without waiting for a regression.
 */
export function ratchet(found, known) {
  const counts = new Map();
  for (const r of found) {
    const k = signature(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const risen = [];
  const fallen = [];
  for (const [k, n] of counts) {
    const allowed = known[k]?.count ?? 0;
    if (n > allowed) risen.push({ key: k, was: allowed, now: n });
  }
  for (const [k, v] of Object.entries(known)) {
    const n = counts.get(k) ?? 0;
    if (n < (v.count ?? 0)) fallen.push({ key: k, was: v.count, now: n });
  }
  return { counts, risen, fallen };
}

async function main() {
  const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const { ids, notes } = await resolveIds();
  for (const n of notes) console.log(`  id   ${n}`);
  const { run, skipped } = routesFor("contrast", ids);
  const routes = only.length ? run.filter((r) => only.includes(r.name)) : run;
  for (const s of skipped) console.log(`  skip ${s.name}: ${s.why}`);

  const browser = await chromium.launch();
  const found = [];
  const where = new Map();
  for (const route of routes) {
    for (const locale of LOCALES) {
      for (const width of CONTRAST_WIDTHS) {
        const ctx = await browser.newContext({
          viewport: { width, height: width < 500 ? 844 : 900 },
          locale: locale.locale,
        });
        const page = await ctx.newPage();
        const path = pathFor(route, locale, ids);
        await page.goto(BASE + path, { waitUntil: "load" }).catch(() => {});
        await page.waitForTimeout(route.settle ?? 2500);
        const rows = await auditContrast(page);
        for (const r of rows) {
          found.push(r);
          const k = signature(r);
          if (!where.has(k)) where.set(k, `${path} @${width} "${r.t}"`);
        }
        console.log(
          `  ${rows.length ? "FAIL" : "ok  "} ${path.padEnd(42)} ${String(width).padStart(4)}  ${rows.length} under AA`,
        );
        await ctx.close();
      }
    }
  }
  await browser.close();

  const known = JSON.parse(readFileSync(KNOWN_PATH, "utf8")).known ?? {};
  const { counts, risen, fallen } = ratchet(found, known);

  if (process.env.UPDATE_CONTRAST === "1") {
    const next = { known: {} };
    for (const [k, n] of [...counts].sort()) {
      next.known[k] = { count: n, why: known[k]?.why ?? `first recorded at ${where.get(k)}` };
    }
    writeFileSync(KNOWN_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(`\n  recorded ${counts.size} known contrast issue(s) -> ${KNOWN_PATH}`);
    return 0;
  }

  for (const f of fallen)
    console.log(`  fixed  ${f.key}: ${f.was} -> ${f.now}. Lower it: UPDATE_CONTRAST=1 node e2e/contrast.spec.mjs`);

  if (risen.length) {
    console.error("\n  contrast REGRESSED:");
    for (const r of risen)
      console.error(`    ${r.key}  allowed ${r.was}, found ${r.now}  first at ${where.get(r.key)}`);
    console.error(
      `\n  ${risen.length} new or worsened contrast failure(s). If one is deliberate, record it with a reason in ${KNOWN_PATH}.`,
    );
    return 1;
  }
  console.log(`\n  no new contrast failures (${counts.size} known, ${found.length} occurrence(s))`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
