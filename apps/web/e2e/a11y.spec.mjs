/**
 * axe-core over every route, in both locales, at a phone width and a laptop
 * width, ratcheted against a written-down list of known issues.
 *
 *   node e2e/a11y.spec.mjs
 *   ONLY=login node e2e/a11y.spec.mjs
 *   UPDATE_A11Y=1 node e2e/a11y.spec.mjs    # re-record e2e/a11y-known.json
 *
 * Before this, accessibility was checked in exactly one place: pages.spec.mjs
 * asserted that every control on /map has an accessible name. /login was in no
 * list at all, so its unlabelled input and its unnamed chart went out under a
 * green CI. Nothing here replaces reading a page with a screen reader; axe
 * finds the mechanical half, which is the half that regresses silently.
 *
 * WHY A KNOWN-ISSUES FILE AND NOT A THRESHOLD. A number ("fewer than 12
 * violations") tells you nothing about which twelve, and quietly absorbs a new
 * one when an old one is fixed. Each line in a11y-known.json names the rule,
 * the route and the reason it is still there, and the count may never rise. The
 * file reaching {} is the goal, and it is visible in a diff when it does not.
 *
 * `color-contrast` is DISABLED here on purpose. axe measures contrast by
 * reading backgrounds out of the DOM, and it cannot see a WebGL canvas behind
 * the map's chrome: it reports the legend and the mode toggle as black on the
 * light page beneath them. That is exactly the phantom failure _contrast.mjs
 * was rewritten to stop producing. Contrast is measured by contrast.spec.mjs,
 * which composites the real ground.
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AXE_WIDTHS, BASE, LOCALES, pathFor, resolveIds, routesFor } from "./routes.mjs";

const require = createRequire(import.meta.url);
/** The bundled build, not the source entry: one file, no module resolution in the page. */
export const AXE_PATH = require.resolve("axe-core/axe.min.js");

const KNOWN_PATH = join(import.meta.dirname, "a11y-known.json");

export const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Rules turned off, each with the reason. Nothing is disabled without one. */
export const DISABLED = {
  "color-contrast":
    "axe reads the background out of the DOM and cannot see the map canvas behind the page chrome, so it reports overlay text against the light page. contrast.spec.mjs measures this properly.",
};

/**
 * Run axe in the page and return its violations.
 *
 * Exported so the self-test can aim it at a fixture with a known missing label:
 * an accessibility check nobody checks is a rubber stamp.
 */
export async function runAxe(page) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(
    async ([tags, disabled]) => {
      const rules = {};
      for (const id of disabled) rules[id] = { enabled: false };
      const res = await window.axe.run(document, {
        runOnly: { type: "tag", values: tags },
        rules,
        resultTypes: ["violations"],
      });
      return res.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        example: v.nodes[0]?.target?.join(" ") ?? "",
      }));
    },
    [TAGS, Object.keys(DISABLED)],
  );
}

export const signature = (rule, routeName) => `${rule} @ ${routeName}`;

/**
 * The ratchet counts CELLS, not nodes.
 *
 * A cell is one (route, locale, width) combination — four per route. Counting
 * violating nodes instead would make the gate depend on how many rows the
 * database happens to return, so the same code would pass on CI's thin fixture
 * and fail on a full local database, which teaches everyone to ignore it.
 */
export function ratchet(found, known) {
  const cells = new Map();
  const nodes = new Map();
  for (const f of found) {
    const k = signature(f.id, f.route);
    cells.set(k, (cells.get(k) ?? 0) + 1);
    nodes.set(k, Math.max(nodes.get(k) ?? 0, f.nodes));
  }
  const risen = [];
  const fallen = [];
  for (const [k, n] of cells) {
    const allowed = known[k]?.cells ?? 0;
    if (n > allowed) risen.push({ key: k, was: allowed, now: n, nodes: nodes.get(k) });
  }
  for (const [k, v] of Object.entries(known)) {
    const n = cells.get(k) ?? 0;
    if (n < (v.cells ?? 0)) fallen.push({ key: k, was: v.cells, now: n });
  }
  return { cells, nodes, risen, fallen };
}

async function main() {
  const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const { ids, notes } = await resolveIds();
  for (const n of notes) console.log(`  id   ${n}`);
  const { run, skipped } = routesFor("axe", ids);
  const routes = only.length ? run.filter((r) => only.includes(r.name)) : run;
  for (const s of skipped) console.log(`  skip ${s.name}: ${s.why}`);

  const browser = await chromium.launch();
  const found = [];
  const where = new Map();
  for (const route of routes) {
    for (const locale of LOCALES) {
      for (const width of AXE_WIDTHS) {
        const ctx = await browser.newContext({
          viewport: { width, height: width < 500 ? 844 : 900 },
          locale: locale.locale,
        });
        const page = await ctx.newPage();
        const path = pathFor(route, locale, ids);
        await page.goto(BASE + path, { waitUntil: "load" }).catch(() => {});
        await page.waitForTimeout(route.settle ?? 2500);
        const violations = await runAxe(page).catch((e) => [
          { id: "axe-failed-to-run", impact: "critical", help: e.message, nodes: 1, example: "" },
        ]);
        for (const v of violations) {
          found.push({ ...v, route: route.name });
          const k = signature(v.id, route.name);
          if (!where.has(k)) where.set(k, `${path} @${width}  ${v.example}`);
        }
        console.log(
          `  ${violations.length ? "FAIL" : "ok  "} ${path.padEnd(42)} ${String(width).padStart(4)}  ` +
            (violations.length
              ? violations.map((v) => `${v.id}×${v.nodes}`).join(" ")
              : "no violations"),
        );
        await ctx.close();
      }
    }
  }
  await browser.close();

  const known = JSON.parse(readFileSync(KNOWN_PATH, "utf8")).known ?? {};
  const { cells, nodes, risen, fallen } = ratchet(found, known);

  if (process.env.UPDATE_A11Y === "1") {
    const next = { note: JSON.parse(readFileSync(KNOWN_PATH, "utf8")).note, known: {} };
    for (const [k, n] of [...cells].sort()) {
      next.known[k] = {
        cells: n,
        nodes: nodes.get(k),
        why: known[k]?.why ?? `RECORDED, NOT EXPLAINED — first seen at ${where.get(k)}`,
      };
    }
    writeFileSync(KNOWN_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(`\n  recorded ${cells.size} known issue(s) -> ${KNOWN_PATH}`);
    console.log("  Every line with RECORDED, NOT EXPLAINED needs a reason or a fix.");
    return 0;
  }

  for (const f of fallen)
    console.log(`  fixed  ${f.key}: ${f.was} -> ${f.now}. Lower it: UPDATE_A11Y=1 node e2e/a11y.spec.mjs`);

  if (risen.length) {
    console.error("\n  accessibility REGRESSED:");
    for (const r of risen)
      console.error(`    ${r.key}  allowed ${r.was} cell(s), found ${r.now} (${r.nodes} node(s))  ${where.get(r.key)}`);
    console.error(
      `\n  ${risen.length} new or worsened rule(s). Fix it, or record it with a reason in ${KNOWN_PATH}.`,
    );
    return 1;
  }
  console.log(`\n  no new axe violations (${cells.size} known, ${routes.length} routes × ${LOCALES.length} locales × ${AXE_WIDTHS.length} widths)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
