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
    const alphaOf = (s) => {
      const m =
        /rgba?\([^)]*?([\d.]+)\s*\)$/.exec(s) || /\/\s*([\d.]+)\s*\)/.exec(s);
      return m ? Number(m[1]) : 1;
    };
    const bgOf = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && bg !== "transparent" && alphaOf(bg) >= 0.75) return parse(bg);
      }
      return [11, 20, 16];
    };
    const out = [];
    for (const el of document.querySelectorAll(
      "p,span,a,h1,h2,h3,li,dt,dd,button,label,td,th,figcaption",
    )) {
      const txt = (el.textContent || "").trim();
      if (!txt || el.children.length > 0) continue;
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
