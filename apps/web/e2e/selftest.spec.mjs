/**
 * The checks, checked.
 *
 *   node e2e/selftest.spec.mjs
 *
 * Needs a browser and no server: it serves e2e/fixtures/selftest.html from a
 * throwaway http server on a free port and points the audits at it.
 *
 * WHY THIS EXISTS. Every audit in this directory has been wrong at least once,
 * and every one of those bugs made it report LESS, not more: a subtree rule
 * that skipped any element with a child hid a chip at 1.06:1 and called the
 * page clean; an alpha regex that read the last number in `rgb(207,114,56)` as
 * an alpha of 56 produced negative ratios; a 0.75 opacity threshold measured
 * map chrome against the page behind it and invented three failures. A silent
 * auditor is indistinguishable from a clean site, which is the failure mode
 * this whole harness exists to remove — so the auditors get the same treatment.
 *
 * It also runs in CI on every pull request, because it is fast (a few seconds,
 * one page, no database) and because these engines are about to be rewritten
 * repeatedly as the redesign lands.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { auditContrast, ratchet as contrastRatchet, signature } from "./contrast.spec.mjs";
import { checkWidths } from "./reflow.spec.mjs";
import { runAxe, ratchet as a11yRatchet } from "./a11y.spec.mjs";
import { galleryHtml } from "./shots.mjs";
import { LOCALES, ROUTES, SHOT_WIDTHS, shotName } from "./routes.mjs";

const FIXTURE = readFileSync(join(import.meta.dirname, "fixtures", "selftest.html"));

let passed = 0;
const failed = [];
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failed.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${detail}`}`);
};

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(FIXTURE);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
const page = await ctx.newPage();
await page.goto(base, { waitUntil: "load" });

/* ---- contrast ---------------------------------------------------------- */

const rows = await auditContrast(page);
const texts = rows.map((r) => r.t);
check(
  "contrast finds the muted caption under AA",
  texts.some((t) => t.startsWith("A muted caption")),
  `found ${JSON.stringify(texts)}`,
);
check(
  "contrast finds the chip, which has an element child",
  rows.some((r) => r.t.includes("回報")),
  `found ${JSON.stringify(texts)}`,
);
check(
  "contrast passes ordinary body text on paper",
  !texts.some((t) => t.startsWith("Ordinary body text")),
);
check(
  "contrast reads the ground under [data-on-dark] and does not invent a failure",
  !texts.some((t) => t.includes("Legend over the map")),
);
check(
  "contrast accepts W2's .on-field rename and an explicit --ground",
  !texts.some((t) => t.includes("Legend after the rename")),
);
const chip = rows.find((r) => r.t.includes("回報"));
check(
  "contrast composites the chip's own background, not the page's",
  chip?.bg === "#0f1c16",
  `bg was ${chip?.bg}`,
);
const muted = rows.find((r) => r.t.startsWith("A muted caption"));
check(
  "the page floor is read from body, not hardcoded",
  muted?.bg === "#faf7f0",
  `floor was ${muted?.bg}`,
);
check(
  "the ratio is the real one",
  muted && Math.abs(muted.ratio - 3.55) < 0.05,
  `parchment-500 on paper-50 measured ${muted?.ratio}, expected 3.55`,
);

/* ---- reflow ------------------------------------------------------------ */

const wide = await checkWidths(page, [320], null);
check("reflow catches a 420px block at 320px", wide.length === 1, JSON.stringify(wide));
check(
  "reflow names the element that sticks out",
  wide[0]?.includes("div.wide"),
  wide[0] ?? "(nothing reported)",
);
check(
  "reflow ignores a wide child inside its own horizontal scroller",
  !(wide[0] ?? "").includes("div.inner"),
  wide[0] ?? "",
);
const roomy = await checkWidths(page, [1000], null);
check("reflow is quiet when the page fits", roomy.length === 0, JSON.stringify(roomy));

/* ---- axe --------------------------------------------------------------- */

const violations = await runAxe(page);
const ids = violations.map((v) => v.id);
check("axe reports the unlabelled input", ids.includes("label"), ids.join(", "));
check("axe reports the image with no alt text", ids.includes("image-alt"), ids.join(", "));
check(
  "axe's own colour-contrast rule stays off — contrast.spec.mjs owns that",
  !ids.includes("color-contrast"),
  ids.join(", "),
);

/* ---- the ratchets ------------------------------------------------------ */

{
  const found = [{ fg: "#8b8270", bg: "#faf7f0", px: 14, bold: false, t: "x" }];
  const key = signature(found[0]);
  check("contrast ratchet fails an unrecorded pair", contrastRatchet(found, {}).risen.length === 1);
  check(
    "contrast ratchet passes a recorded pair at the same count",
    contrastRatchet(found, { [key]: { count: 1 } }).risen.length === 0,
  );
  check(
    "contrast ratchet fails when a recorded pair spreads",
    contrastRatchet([...found, ...found], { [key]: { count: 1 } }).risen.length === 1,
  );
  check(
    "contrast ratchet notices a pair that was fixed",
    contrastRatchet([], { [key]: { count: 1 } }).fallen.length === 1,
  );
}
{
  const found = [{ id: "label", route: "login", nodes: 2 }];
  check("axe ratchet fails a new rule", a11yRatchet(found, {}).risen.length === 1);
  check(
    "axe ratchet counts cells, not nodes, so the size of the database cannot move it",
    a11yRatchet([{ id: "label", route: "login", nodes: 99 }], { "label @ login": { cells: 1 } })
      .risen.length === 0,
  );
}

/* ---- the route table and the gallery ----------------------------------- */

{
  const entries = [];
  for (const route of ROUTES.slice(0, 3))
    for (const locale of LOCALES)
      for (const width of SHOT_WIDTHS)
        entries.push({
          file: shotName(route, locale, width, "fold") + ".png",
          route: route.name,
          locale: locale.id,
          width,
          part: "fold",
          state: null,
        });
  const html = galleryHtml(entries, { taken: "now", base });
  check(
    "every shot appears in the gallery",
    entries.every((e) => html.includes(e.file)),
  );
  check("filenames are unique", new Set(entries.map((e) => e.file)).size === entries.length);
  check(
    "a filename is stable across runs",
    shotName(ROUTES[1], LOCALES[1], 390, "fold") === "map-en-w390-fold",
    shotName(ROUTES[1], LOCALES[1], 390, "fold"),
  );
}

await browser.close();
server.close();

console.log(
  failed.length
    ? `\n  ${failed.length} of ${passed + failed.length} self-checks FAILED:\n    ${failed.join("\n    ")}`
    : `\n  ${passed}/${passed} self-checks passed — the audits still find what they are for`,
);
process.exit(failed.length ? 1 : 0);
