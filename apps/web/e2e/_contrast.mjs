/**
 * WCAG AA contrast audit of the rendered pages.
 *
 * Not a test — it needs a running dev server and CI does not run it. It exists
 * because contrast is the one part of a design that cannot be judged by eye:
 * parchment-500 looked fine on every screenshot in this project and measured
 * 4.05:1, under the 4.5 threshold, while being the token every muted caption
 * and rank number used.
 *
 *   node apps/web/e2e/_contrast.mjs            # desktop
 *   node apps/web/e2e/_contrast.mjs --mobile   # 390px
 *
 * Reports only failures, deduplicated by colour/size, quietest first.
 */
import { chromium } from "playwright";
const PAGES = [
  "/",
  "/map",
  "/species",
  "/stats",
  "/about",
  "/reports",
  "/report",
  "/attribution",
];
const MOBILE = process.argv.includes("--mobile");
const b = await chromium.launch();
const seen = new Map();
for (const path of PAGES) {
  const p = await b.newPage({
    viewport: { width: MOBILE ? 390 : 1180, height: MOBILE ? 844 : 900 },
  });
  await p.goto("http://localhost:3000" + path, { waitUntil: "load" });
  await p.waitForTimeout(
    path === "/" || path === "/map" || path === "/report" ? 12000 : 3500,
  );
  const rows = await p.evaluate(() => {
    const lum = (c) => {
      const [r, g, bb] = c.map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bb;
    };
    // 0.75, not 0.85: the map's legend and mode toggle sit on bg-bark-900/80, and
    // skipping those made the audit measure their text against the light page
    // behind them and report three failures that were not real.
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
     * Composite the background the way the browser does, instead of hunting for
     * the first layer opaque enough to count.
     *
     * The old version took any layer at 75% or more and ignored the rest. That
     * is two errors in opposite directions: a 70% panel over the dark map was
     * skipped entirely, so its text was measured against the light page behind
     * and reported as a failure it was not; and a 76% panel was treated as
     * fully opaque, overstating contrast slightly. The threshold was a guess
     * standing in for arithmetic.
     *
     * Now every semi-transparent layer is composited onto what is behind it,
     * which is what the eye actually receives.
     */
    const bgOf = (el) => {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        // The map is a canvas, not a background colour, so the DOM cannot say
        // what is behind chrome laid over it. The marker does.
        if (n.dataset && n.dataset.onDark !== undefined) {
          layers.push([[11, 20, 16], 1]);
          break;
        }
        const bg = getComputedStyle(n).backgroundColor;
        if (!bg || bg === "transparent") continue;
        const a = alphaOf(bg);
        if (a <= 0) continue;
        layers.push([parse(bg), a]);
        if (a >= 0.999) break;
      }
      // Nothing opaque found: the page's own surface is the floor.
      let [r, g, b] = [250, 247, 240];
      for (let i = layers.length - 1; i >= 0; i--) {
        const [c, a] = layers[i];
        r = c[0] * a + r * (1 - a);
        g = c[1] * a + g * (1 - a);
        b = c[2] * a + b * (1 - a);
      }
      return [r, g, b];
    };
    const out = [];
    for (const el of document.querySelectorAll(
      "p,span,a,h1,h2,h3,li,dt,dd,button,label,td,th,figcaption",
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
      if (ratio < need)
        out.push({
          t: txt.slice(0, 22),
          fg: cs.color,
          px: Math.round(px),
          ratio: +ratio.toFixed(2),
          need,
        });
    }
    return out;
  });
  for (const r of rows) {
    const k = `${r.fg}|${r.px}|${r.ratio}`;
    if (!seen.has(k)) seen.set(k, { ...r, where: path });
  }
  await p.close();
}
await b.close();
const all = [...seen.values()].sort((a, b2) => a.ratio - b2.ratio);
console.log(
  all.length
    ? all
        .map(
          (r) =>
            `  ${String(r.ratio).padStart(5)} (need ${r.need})  ${r.px}px  ${r.fg.padEnd(20)} ${r.where.padEnd(13)} "${r.t}"`,
        )
        .join("\n")
    : "  every text/background pair meets WCAG AA",
);
