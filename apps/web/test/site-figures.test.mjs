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
 * The tag is also what drops a cached PAGE that shows records: a page is
 * dropped when a record on it changes only because something it read carries
 * the tag. So every cached page that reads the records reads at least one of
 * them through the tagged cache, and the walk below says which page does not.
 *
 * Except a record's point, which no cache may hold: a cached figure can be
 * five minutes old when a page is made from it, and the page is served for
 * ten more, so a blur tightened in the database stayed on a species page for
 * fifteen minutes. Every read that places a record is made afresh, and the
 * walk below says which one is behind a cache.
 *
 * Source-level: what matters is which function a page calls and which writer
 * says the reports changed. A rendered comparison would pass whether or not
 * anything was cached. test/public-pages-cache.test.mjs has the live half: a
 * cached species page losing a record that was re-identified or blurred.
 *
 *   node --test test/site-figures.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

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

  test("and dropped again a few seconds later, for a rebuild that read before the write, or a drop that failed", () => {
    const src = code("lib/siteFigures.ts");
    assert.match(src, /export function reportsChanged\(\): void \{\s*revalidateTag\(REPORTS_TAG, \{ expire: 0 \}\);\s*after\(async \(\) => \{\s*await new Promise\(\(resolve\) => setTimeout\(resolve, AGAIN_AFTER_MS\)\);\s*revalidateTag\(REPORTS_TAG, \{ expire: 0 \}\);\s*\}\);\s*\}/);
    const again = Number(/const AGAIN_AFTER_MS = ([\d_]+);/.exec(src)?.[1].replaceAll("_", ""));
    // Seconds, not minutes: it has to fit in the function's time after the
    // answer, and a cron run uses 45 of its 60 before it answers.
    assert.ok(again >= 2_000 && again <= 10_000, `AGAIN_AFTER_MS is ${again}`);
  });

  for (const [file, names] of [
    ["lib/stats.ts", ["recordedSpeciesCount", "checklistAnimalTaxaCount", "overview", "monthlyTotals", "yearlyTotals", "topSpecies", "mapEntrySpecies"]],
    ["lib/collections.ts", ["collectionTotals", "collectionSummary", "newestRecords", "invasiveSpeciesList"]],
    ["lib/species.ts", ["monthlyCounts"]],
    ["lib/coverage.ts", ["coverage"]],
  ])
    test(`${file}: ${names.join(", ")}`, () => {
      const src = code(file);
      for (const name of names)
        assert.match(src, new RegExp(`export const ${name} = siteFigure\\(\\s*"${name}",`), name);
    });

  test("the anniversary ledger and the hotspots, which place records, afresh, and none when the database fails", () => {
    // The ledger's window is drawn around Taipei's date, passed in, rather
    // than around the database's now().
    const src = code("lib/stats.ts");
    assert.match(src, /export function anniversaryLedger\(limit = 12\)[\s\S]*?timeZone: "Asia\/Taipei"[\s\S]*?return freshPoints\("anniversaryLedger", \(\) => ledgerAround\(today, limit\)\);/);
    const ledger = src.slice(src.indexOf("function ledgerAround"));
    assert.match(ledger, /generate_series\(\s*\$\{day\}::date - 3,\s*\$\{day\}::date \+ 3,/);
    assert.doesNotMatch(ledger.slice(0, ledger.indexOf("limit ${limit}")), /now\(\)/);
    assert.match(src, /export function hotspots\(limit: number = 8\): Promise<Hotspot\[\]> \{\s*return freshPoints\("hotspots", \(\) => asPublic\(/);
    // No points rather than an error: a rebuild that throws keeps the old
    // page, and the old page has the old points.
    const fresh = code("lib/siteFigures.ts");
    assert.match(fresh, /export async function freshPoints<R>\(name: string, read: \(\) => Promise<R\[\]>\): Promise<R\[\]> \{\s*try \{\s*return await read\(\);\s*\} catch \(e\) \{[\s\S]*?return \[\];\s*\}\s*\}/);
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

  test("a report published on arrival, and one the model has seen, even when the run throws", () => {
    const route = code("app/api/reports/route.ts");
    assert.match(route, /if \(!result\.duplicate && result\.status === "published" && !result\.test\) reportsChanged\(\);/);
    // The count the run keeps as it goes, read in `finally`: a run can throw
    // after a job it finished has committed, and that job's report is public.
    assert.match(route, /const progress = \{ processed: 0 \};\s*try \{\s*await classifyQueued\(\{ reportId: id, progress \}\);\s*\} catch \(e\) \{[\s\S]*?\} finally \{\s*if \(progress\.processed > 0\) reportsChanged\(\);\s*\}/);
    // The cron's run, recorded in job_runs, inside the same `try`. Awaited:
    // returned unawaited, `finally` would read the count before any job ran.
    const cron = code("app/api/jobs/classify/route.ts");
    assert.match(cron, /const progress = \{\s*processed: 0\s*\};\s*try\s*\{\s*return await withJobRun\(\s*"classify",\s*async\s*\(\)\s*=>\s*\{\s*const outcome = await classifyQueued\(\{\s*progress\s*\}\);\s*return Response\.json\(outcome\);\s*\},?\s*\);\s*\}\s*finally\s*\{\s*if \(progress\.processed > 0\) reportsChanged\(\);\s*\}/);
  });

  test("…and only a model run that finished a job, because one that did not changed nothing public", () => {
    // Dropping the tag empties every cached page at once, and a submission
    // that is held, or a cron run with nothing to do, used to do it anyway.
    // Skipping it is right only while what an unfinished run writes stays on
    // held reports, which no page shows: the sweep of abandoned jobs, and the
    // give-up branch.
    const worker = code("lib/report/classifyWorker.ts");
    const sweep = worker.slice(worker.indexOf("export async function classifyQueued"), worker.indexOf("const jobs = await sql"));
    const failing = worker.slice(worker.indexOf("} catch (err) {"), worker.indexOf("console.error(`[jobs/classify]"));
    for (const [where, src] of [["the sweep", sweep], ["a failed job", failing]]) {
      const updates = [...src.matchAll(/update reports\b[\s\S]*?`/g)].map((m) => m[0]);
      assert.ok(updates.length > 0, `${where} no longer updates reports; is the slice wrong?`);
      for (const u of updates) assert.match(u, /status = 'pending'/, `${where} writes to a report that may be public`);
    }
    // `processed` counts the jobs that finished, and nothing else, as they
    // finish, in the object the caller passed.
    assert.match(worker, /progress = \{ processed: 0 \},\s*\}: \{ reportId\?: string \| null; progress\?: ClassifyProgress \} = \{\}/);
    assert.match(worker, /processed: progress\.processed,/);
    assert.equal(worker.match(/progress\.processed\+\+;/g)?.length, 2, "one for each contract's finished job");
    assert.doesNotMatch(worker, /processed(?:\s*\+=|\s*=(?!=)|--)/, "something else changes the count");
  });
});

/* ------------------------------------------------------------------ *
 * Every cached page's reads of the records carry the tag, and no cache
 * holds a record's point
 * ------------------------------------------------------------------ */

/** A read of the public records, or of the table under them. */
const READS_RECORDS = /\b(?:reports_public|reports_published|species_report_stats)\b|\b(?:from|join)\s+reports\b/;
/** A declaration that is a read through the tagged cache. */
const TAGGED = /^(?:export\s+)?const\s+[\w$]+\s*=\s*(?:cache\(\s*)?siteFigure\(/;
/** A declaration that caches what it reads, through the figures or not. */
const CACHED = /\b(?:siteFigure|unstable_cache)\(|^\s*["']use cache["']/m;
/** A read that hands back where a record is: a latitude or a longitude. */
const PLACES_RECORDS = /\bas\s+"?(?:lat|lng)"?\b/;
/**
 * Reads of the records a cached page may make without a tagged one beside
 * them, each with why it cannot hold anything a re-identification or a blur
 * would change.
 */
const UNTAGGED = new Map([
  // Cached on its own for five minutes, untagged. It answers whether any person
  // has filed a report at all: no record, no place and no count.
  ["lib/coverage.ts#seasonOpen", "yes or no, nothing about any record"],
]);

const declarations = new Map();
/**
 * A module's top-level declarations, its imports and its re-exports. The
 * code is formatted, so a declaration starts at the line's first column and
 * runs to the next one that does.
 */
function parse(file) {
  if (declarations.has(file)) return declarations.get(file);
  const src = readFileSync(file, "utf8");
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const decls = new Map();
  let defaultName = /^export\s+default\s+([\w$]+);/m.exec(clean)?.[1];
  const starts = [...clean.matchAll(/^(?:export|const|let|function|async|type|interface|import|class)\b.*$/gm)];
  starts.forEach((m, i) => {
    const text = clean.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : clean.length);
    const name =
      /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*([\w$]*)/.exec(text)?.[1] ??
      /^(?:export\s+)?(?:const|let)\s+([\w$]+)\s*=/.exec(text)?.[1];
    if (name === undefined) return;
    // An unnamed default export is known by "default".
    decls.set(name || "default", text);
    if (/^export\s+default\b/.test(text)) defaultName = name || "default";
  });

  const imports = new Map();
  for (const m of clean.matchAll(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/gm)) {
    if (m[1]) continue;
    const [, , clause, spec] = m;
    const def = /^([\w$]+)/.exec(clause)?.[1];
    if (def) imports.set(def, { spec, imported: "default" });
    for (const part of (/\{([\s\S]*)\}/.exec(clause)?.[1] ?? "").split(",")) {
      const item = part.trim();
      if (!item || item.startsWith("type ")) continue;
      const [imported, local = imported] = item.split(/\s+as\s+/);
      imports.set(local, { spec, imported });
    }
  }
  const reexports = new Map();
  for (const m of clean.matchAll(/^export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm))
    for (const part of m[1].split(",")) {
      const [imported, exported = imported] = part.trim().split(/\s+as\s+/);
      if (imported) reexports.set(exported, { spec: m[2], imported });
    }
  const parsed = { client: /^\s*["']use client["']/.test(src), decls, defaultName, imports, reexports };
  declarations.set(file, parsed);
  return parsed;
}

function resolveModule(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(WEB, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")])
    if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/**
 * Where `name`, declared in `file`, reads the records without the tag, as the
 * path to that read, or null. Follows the module's own declarations and its
 * imports, components included; stops at a tagged read, at an allowed one and
 * at the browser's modules, which read no database.
 */
function untaggedRead(file, asked, trail, seen) {
  const mod = parse(file);
  if (mod.client) return null;
  const name = asked === "default" ? (mod.defaultName ?? asked) : asked;
  const key = `${relative(WEB, file)}#${name}`;
  if (seen.has(key) || UNTAGGED.has(key)) return null;
  seen.add(key);
  const text = mod.decls.get(name);
  if (text === undefined) {
    const re = mod.reexports.get(name);
    const target = re && resolveModule(file, re.spec);
    return target ? untaggedRead(target, re.imported, trail, seen) : null;
  }
  const here = [...trail, key];
  if (TAGGED.test(text)) return null;
  if (READS_RECORDS.test(text)) return here.join(" -> ");
  for (const id of new Set(text.match(/[A-Za-z_$][\w$]*/g))) {
    if (id === name || id === "default") continue;
    let found = null;
    if (mod.decls.has(id)) found = untaggedRead(file, id, here, seen);
    else if (mod.imports.has(id)) {
      const { spec, imported } = mod.imports.get(id);
      const target = resolveModule(file, spec);
      if (target) found = untaggedRead(target, imported, here, seen);
    }
    if (found) return found;
  }
  return null;
}

/**
 * The first declaration `name` reaches, itself included, for which
 * `found(key, text)` holds, as the path to it, or null. Follows declarations
 * and imports as untaggedRead does; does not go past one for which
 * `stop(key, text)` holds, nor into the browser's modules.
 */
function reaches(file, asked, { found, stop = () => false }, trail = [], seen = new Set()) {
  const mod = parse(file);
  if (mod.client) return null;
  const name = asked === "default" ? (mod.defaultName ?? asked) : asked;
  const key = `${relative(WEB, file)}#${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const text = mod.decls.get(name);
  if (text === undefined) {
    const re = mod.reexports.get(name);
    const target = re && resolveModule(file, re.spec);
    return target ? reaches(target, re.imported, { found, stop }, trail, seen) : null;
  }
  const here = [...trail, key];
  if (found(key, text)) return here.join(" -> ");
  if (stop(key, text)) return null;
  for (const id of new Set(text.match(/[A-Za-z_$][\w$]*/g))) {
    if (id === name || id === "default") continue;
    let hit = null;
    if (mod.decls.has(id)) hit = reaches(file, id, { found, stop }, here, seen);
    else if (mod.imports.has(id)) {
      const { spec, imported } = mod.imports.get(id);
      const target = resolveModule(file, spec);
      if (target) hit = reaches(target, imported, { found, stop }, here, seen);
    }
    if (hit) return hit;
  }
  return null;
}

/** Where `name` in `file` reads through the tagged cache, or null. */
const taggedRead = (file, name) => reaches(file, name, { found: (_, text) => TAGGED.test(text) });

/** Where something `name` in `file` reaches places a record, or null. */
const placesRecords = (file, name) => reaches(file, name, { found: (_, text) => PLACES_RECORDS.test(text) });

function pageFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...pageFiles(p));
    else if (entry === "page.tsx") out.push(p);
  }
  return out;
}

/** The layouts a page renders inside, its own directory's first. */
function layoutsOf(page) {
  const out = [];
  for (let dir = dirname(page); dir.startsWith(join(WEB, "app")); dir = dirname(dir)) {
    const layout = join(dir, "layout.tsx");
    if (existsSync(layout)) out.push(layout);
  }
  return out;
}

/**
 * The pages Next caches: not forced per request by themselves or a layout,
 * not reading the query string (which renders per request), and, for a
 * segment of their own like [id], with params generated beside them.
 */
function cachedPages() {
  return pageFiles(join(WEB, "app")).filter((page) => {
    const src = code(relative(WEB, page));
    const layouts = layoutsOf(page).map((l) => code(relative(WEB, l)));
    if ([src, ...layouts].some((s) => /export const dynamic = "force-dynamic"/.test(s))) return false;
    if (/\bsearchParams\b/.test(src)) return false;
    if (/^\[.+\]$/.test(basename(dirname(page)))) {
      const own = join(dirname(page), "layout.tsx");
      const beside = existsSync(own) ? code(relative(WEB, own)) : "";
      if (!/generateStaticParams/.test(src + beside)) return false;
    }
    return true;
  });
}

/** Every untagged read of the records that `file` (a page or a layout) makes. */
function untaggedReads(file) {
  const out = [];
  for (const name of parse(file).decls.keys()) {
    // Asked at build, for which pages to build; nothing it reads is shown.
    if (name === "generateStaticParams") continue;
    const found = untaggedRead(file, name, [], new Set());
    if (found) out.push(found);
  }
  return out;
}

/** Every .ts and .tsx file under `dir`. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

describe("every cached page reads the records through the tag", () => {
  test("the walk finds the cached pages, and only those", () => {
    const pages = cachedPages().map((p) => relative(WEB, p));
    for (const expected of [
      "app/[locale]/page.tsx",
      "app/[locale]/(site)/species/[id]/page.tsx",
      "app/[locale]/(site)/stats/page.tsx",
      "app/[locale]/(site)/season/page.tsx",
      "app/[locale]/(site)/roadkill/page.tsx",
      "app/[locale]/(site)/attribution/page.tsx",
      "app/[locale]/lab/[direction]/page.tsx",
    ])
      assert.ok(pages.includes(expected), `${expected} is cached and the walk missed it`);
    for (const perRequest of [
      "app/[locale]/(site)/reports/[id]/page.tsx",
      "app/[locale]/(site)/species/by-id/[id]/page.tsx",
      "app/[locale]/(site)/species/(directory)/page.tsx",
      "app/[locale]/map/page.tsx",
      "app/[locale]/(site)/me/page.tsx",
      "app/[locale]/lab/[direction]/species/[id]/page.tsx",
    ])
      assert.ok(!pages.includes(perRequest), `${perRequest} renders per request, and the walk counts it as cached`);
  });

  test("the walk does see an untagged read", () => {
    // The control: the record page's species card is read afresh, by design,
    // and so is the species directory's list. Were the walk blind, every page
    // below would pass.
    const species = join(WEB, "lib", "species.ts");
    assert.match(untaggedRead(species, "getSpecies", [], new Set()) ?? "", /lib\/species\.ts#readSpecies$/);
    assert.ok(untaggedRead(species, "listSpecies", [], new Set()));
    assert.equal(untaggedRead(species, "getCachedSpecies", [], new Set()), null);
  });

  test("the walk sees a tagged read, and sees there is none", () => {
    // The control for the rule below: the species page reads its taxon
    // through the tag, and the bare-id redirect, rendered per request, reads
    // nothing through it.
    const species = join(WEB, "app", "[locale]", "(site)", "species", "[id]", "page.tsx");
    assert.match(taggedRead(species, "default") ?? "", /lib\/species\.ts#getCachedSpecies$/);
    const byId = join(WEB, "app", "[locale]", "(site)", "species", "by-id", "[id]", "page.tsx");
    assert.equal(taggedRead(byId, "default"), null);
  });

  test("a cached page that reads the records outside the tag reads something through it too", () => {
    // An untagged read is how a point is read, afresh, and it is fine on a
    // page that carries the tag through another read: the writers drop the
    // page with that one. On a page with no tagged read at all, nothing but
    // the page's own lifetime would drop it when a record changes.
    const pages = cachedPages();
    assert.ok(pages.length >= 12, `only ${pages.length} cached pages found; is the walk broken?`);
    const untagged = [];
    const riding = [];
    for (const page of pages) {
      const files = [page, ...layoutsOf(page)];
      const reads = files.flatMap((f) => untaggedReads(f));
      if (reads.length === 0) continue;
      const tagged = files.flatMap((f) => [...parse(f).decls.keys()]
        .filter((n) => n !== "generateStaticParams")
        .map((n) => taggedRead(f, n))
        .filter(Boolean));
      if (tagged.length === 0) untagged.push(...reads);
      else riding.push(relative(WEB, page));
    }
    assert.deepEqual(untagged, []);
    // The control: /stats reads its hotspots afresh, beside its tagged counts.
    assert.ok(riding.includes("app/[locale]/(site)/stats/page.tsx"), `the walk saw no untagged read on /stats: ${riding}`);
  });
});

describe("no cache holds a record's point", () => {
  const files = [...sourceFiles(join(WEB, "lib")), ...sourceFiles(join(WEB, "app"))];

  test("the walk finds the reads that place records", () => {
    // The control: each of these hands back a latitude and a longitude, and
    // the walk sees through the helper that reads two of them.
    const found = [];
    for (const file of files)
      for (const [name, text] of parse(file).decls)
        if (PLACES_RECORDS.test(text)) found.push(`${relative(WEB, file)}#${name}`);
    for (const read of ["lib/species.ts#recentRecords", "lib/stats.ts#ledgerAround", "lib/stats.ts#hotspots"])
      assert.ok(found.includes(read), `${read} no longer places records; is the pattern wrong?`);
    assert.match(placesRecords(join(WEB, "lib", "stats.ts"), "anniversaryLedger") ?? "", /lib\/stats\.ts#ledgerAround$/);
  });

  test("none of them is read through a cache, directly or through anything it calls", () => {
    // A cached figure can be five minutes old when a page is made from it,
    // and the page is served for ten more: a point read through one stayed
    // on a species page fifteen minutes after its blur was tightened.
    const cachedPoints = [];
    for (const file of files)
      for (const [name, text] of parse(file).decls) {
        if (!CACHED.test(text)) continue;
        const hit = placesRecords(file, name);
        if (hit) cachedPoints.push(hit);
      }
    assert.deepEqual(cachedPoints, []);
  });

  test("and the walk would see one that is", () => {
    // The control: a figure the walk knows is cached, and one that reaches a
    // point read, so the two halves of the rule above are both seen.
    const stats = join(WEB, "lib", "stats.ts");
    assert.ok(CACHED.test(parse(stats).decls.get("overview")), "overview is no longer seen as cached");
    assert.equal(placesRecords(stats, "overview"), null);
    assert.ok(placesRecords(stats, "hotspots"));
  });
});
