/**
 * The figures every page states are computed once for everybody, and dropped
 * when the reports change.
 *
 * Each was a full pass over reports_public on every page view; the species
 * count alone was called 10,505 times in production at 241 ms each. They are
 * cached for five minutes under the tag "reports" (lib/siteFigures.ts), and
 * everything that publishes a report, rejects one or gives one another species
 * drops them, so a published record is counted on the next view rather than
 * five minutes later.
 *
 * Source-level: what matters is which function a page calls and which writer
 * says the reports changed. A rendered comparison would pass whether or not
 * anything was cached.
 *
 *   node --test test/site-figures.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "..");
/** Code without comments, so an explanation cannot pass for a call. */
const code = (p) => readFileSync(join(WEB, p), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

/** The body of an exported function, by brace matching; its brace ends its line. */
function body(src, name) {
  const at = src.indexOf(`export async function ${name}(`);
  assert.notEqual(at, -1, `${name} is gone or renamed`);
  const open = src.indexOf("{\n", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced braces after ${name}`);
}

describe("the site-wide figures are cached", () => {
  test("for five minutes, under the tag the writers drop", () => {
    const src = code("lib/siteFigures.ts");
    assert.match(src, /export const REPORTS_TAG = "reports";/);
    assert.match(src, /unstable_cache\(read, \["site-figure", name\], \{\s*revalidate: FIVE_MINUTES,\s*tags: \[REPORTS_TAG\],\s*\}\)/);
    assert.match(src, /const FIVE_MINUTES = 300;/);
    assert.match(src, /revalidateTag\(REPORTS_TAG, \{ expire: 0 \}\)/);
  });

  for (const [file, names] of [
    ["lib/stats.ts", ["recordedSpeciesCount", "checklistAnimalTaxaCount", "overview", "monthlyTotals", "yearlyTotals", "topSpecies", "mapEntrySpecies", "hotspots"]],
    ["lib/collections.ts", ["collectionTotals"]],
  ])
    test(`${file}: ${names.join(", ")}`, () => {
      const src = code(file);
      for (const name of names)
        assert.match(src, new RegExp(`export const ${name} = siteFigure\\(\\s*"${name}",`), name);
    });

  test("the anniversary ledger is not: it moves with the date", () => {
    assert.match(code("lib/stats.ts"), /export async function anniversaryLedger\(/);
  });

  test("the home page, the map and the list read their counts from the cached overview", () => {
    // Each asked the same question of the same view with a query of its own.
    for (const page of ["app/[locale]/page.tsx", "app/[locale]/map/page.tsx", "app/[locale]/(site)/reports/(list)/page.tsx"]) {
      const src = code(page);
      assert.match(src, /overview\(\)/, page);
      assert.doesNotMatch(src, /count\(\*\)(?: filter \(where is_obscured\))?::(?:text|int)\s+as\s+(?:reports|obscured|n)\b/, page);
    }
  });
});

describe("everything that changes the reports drops them", () => {
  const ADMIN = "app/[locale]/(site)/admin/actions.ts";
  for (const [file, fn] of [
    [ADMIN, "publishReport"],
    [ADMIN, "rejectReport"],
    [ADMIN, "setReportTaxon"],
    ["app/[locale]/(site)/reports/[id]/actions.ts", "confirmSpecies"],
  ])
    test(`${fn}, after its transaction`, () => {
      const src = body(code(file), fn);
      const write = src.lastIndexOf("sql.begin(");
      const drop = src.indexOf("reportsChanged();");
      assert.ok(write > -1, `${fn} no longer writes in a transaction`);
      assert.ok(drop > write, `${fn} does not call reportsChanged() after its write`);
    });

  test("a report published on arrival, and one the model has seen", () => {
    const route = code("app/api/reports/route.ts");
    assert.match(route, /if \(!result\.duplicate && result\.status === "published" && !result\.test\) reportsChanged\(\);/);
    assert.match(route, /await classifyQueued\(\{ reportId: id \}\);\s*reportsChanged\(\);/);
    const cron = code("app/api/jobs/classify/route.ts");
    assert.match(cron, /Response\.json\(await classifyQueued\(\)\);\s*reportsChanged\(\);/);
  });
});
