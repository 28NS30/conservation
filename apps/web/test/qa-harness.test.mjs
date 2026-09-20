/**
 * The QA harness, checked without a browser.
 *
 * These are the parts that can be wrong while every screenshot still looks
 * right: a page nobody registered, a namespace nobody derived, a known-issues
 * file with no reasons in it, a script CI never calls. The browser half — do
 * the audits still find a 1.06:1 chip, does the reflow sweep still name the
 * element sticking out — is `e2e/selftest.spec.mjs`, which needs Chromium.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  LOCALES,
  ROUTES,
  STATES,
  enPath,
  leakedKeyPattern,
  namespaces,
  pathFor,
  routesFor,
  shotName,
} from "../e2e/routes.mjs";

const WEB = join(import.meta.dirname, "..");
const REPO = join(WEB, "..", "..");

/** Every `page.tsx` under app/, as the path a visitor types. */
function appRoutes(dir = join(WEB, "app"), prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // Route groups "(site)" and the [locale] segment are invisible in a URL.
      const seg = /^\(.*\)$/.test(name) || name === "[locale]" ? "" : "/" + name;
      out.push(...appRoutes(full, prefix + seg));
    } else if (name === "page.tsx") {
      out.push(prefix === "" ? "/" : prefix);
    }
  }
  return out;
}

/** "/reports/[id]" as a matcher: one segment, anything in it. */
const asRegExp = (pattern) =>
  new RegExp("^" + pattern.replace(/\[[^\]]+\]/g, "[^/]+") + "$");

test("every page the app serves has a row in the route table", () => {
  const missing = appRoutes().filter(
    (r) => !ROUTES.some((row) => asRegExp(r).test(row.path.replace("__ID__", "x"))),
  );
  assert.deepEqual(
    missing,
    [],
    `Add these to e2e/routes.mjs, or five separate checks will go on not knowing about them: ${missing.join(", ")}`,
  );
});

test("no row points at a page that does not exist", () => {
  const app = appRoutes().map(asRegExp);
  const phantom = ROUTES.filter(
    (row) => !row.expectStatus && !app.some((re) => re.test(row.path.replace("__ID__", "x"))),
  ).map((r) => r.name);
  assert.deepEqual(phantom, []);
});

test("the 404 probe is deliberately a path no route serves", () => {
  // By name, not by `expectStatus`. Two rows expect a 404 now and they mean
  // different things: this one proves a miss really misses, and /team is a real
  // page whose data makes it 404 today. Finding "the" 404 row would pick
  // whichever came first in the file.
  const row = ROUTES.find((r) => r.name === "not-found");
  assert.ok(row, "the route table has no 404 probe");
  assert.equal(row.expectStatus, 404);
  assert.ok(!appRoutes().some((r) => asRegExp(r).test(row.path)));
});

test("every other 404 row is a real page, and says why it 404s", () => {
  // The opposite check, and the one that matters when the reason changes:
  // /team is served by an app route and answers 404 only because lib/team.ts
  // publishes it when the roster is non-empty. If the roster lands and nobody
  // updates the table, the sweep fails — which is the point — but this keeps
  // the row from being mistaken for another unrouted probe in the meantime.
  for (const row of ROUTES.filter(
    (r) => r.expectStatus === 404 && r.name !== "not-found",
  )) {
    assert.ok(
      appRoutes().some((r) => asRegExp(r).test(row.path)),
      `${row.name}: expects 404 but no app route serves ${row.path} — if it is a probe, name it`,
    );
  }
});

test("the moderation queue is kept out of the gallery, with a reason", () => {
  const { run, skipped } = routesFor("shots", {});
  assert.ok(!run.some((r) => r.name === "admin"));
  const why = skipped.find((s) => s.name === "admin")?.why ?? "";
  assert.match(why, /coordinate/i, "the reason must say what the risk is");
});

test("/me is only ever visited signed out", () => {
  // Signed in it lists one person's own reports at full precision. Nothing in
  // the harness authenticates, and this is the row that says so out loud.
  assert.equal(ROUTES.find((r) => r.name === "me").signedOutOnly, true);
  assert.equal(ROUTES.find((r) => r.name === "admin").signedOutOnly, true);
});

test("namespaces come from the catalogue, not from a hand-written list", () => {
  const ns = namespaces();
  const en = JSON.parse(readFileSync(join(WEB, "messages", "en.json"), "utf8"));
  assert.deepEqual(ns.sort(), Object.keys(en).sort());
  // The two that pages.spec.mjs's hardcoded array is missing, which is how a
  // leaked `team.*` key renders on the page and passes CI.
  assert.ok(ns.includes("team"));
  assert.ok(ns.includes("statsPage"));
});

test("a leaked message key is recognised, including the ones the old list missed", () => {
  const re = leakedKeyPattern();
  for (const leak of ["team.title", "statsPage.heading", "map.cellCount"])
    assert.match(leak, new RegExp(re.source), `${leak} would render as itself and pass`);
});

test("both catalogues carry the same namespaces", () => {
  const zh = JSON.parse(readFileSync(join(WEB, "messages", "zh-TW.json"), "utf8"));
  assert.deepEqual(Object.keys(zh).sort(), namespaces().sort());
});

test("the English twin of / is /en, not /en/", () => {
  assert.equal(enPath("/"), "/en");
  assert.equal(enPath("/map"), "/en/map");
  assert.equal(pathFor({ name: "map", path: "/map" }, LOCALES[1]), "/en/map");
});

test("screenshot filenames are stable and unique", () => {
  const seen = new Set();
  for (const route of ROUTES)
    for (const locale of LOCALES)
      for (const width of [390, 768, 1440])
        for (const part of ["fold", "full"]) {
          const name = shotName(route, locale, width, part);
          assert.ok(!seen.has(name), `${name} is produced twice`);
          assert.match(name, /^[a-z0-9-]+$/);
          seen.add(name);
        }
  assert.equal(shotName(ROUTES[1], LOCALES[1], 390, "fold"), "map-en-w390-fold");
});

test("every state driver says what it is and why", () => {
  for (const [route, states] of Object.entries(STATES)) {
    assert.ok(ROUTES.some((r) => r.name === route), `${route} is not a route`);
    for (const s of states) {
      assert.ok(s.id && /^[a-z-]+$/.test(s.id));
      assert.ok((s.why ?? "").length > 20, `state ${route}/${s.id} has no reason`);
      assert.equal(typeof s.drive, "function");
    }
  }
});

test("the known-issue files are lists with reasons, not thresholds", () => {
  for (const file of ["a11y-known.json", "contrast-known.json"]) {
    const doc = JSON.parse(readFileSync(join(WEB, "e2e", file), "utf8"));
    assert.ok(doc.note.length > 80, `${file} must explain itself`);
    assert.equal(typeof doc.known, "object");
    for (const [key, value] of Object.entries(doc.known))
      assert.ok(
        (value.why ?? "").length > 10,
        `${file}: "${key}" is recorded with no reason. A known issue with no reason is a threshold.`,
      );
  }
});

test("the performance budget distinguishes unrecorded from zero", () => {
  const b = JSON.parse(readFileSync(join(WEB, "e2e", "perf-budget.json"), "utf8"));
  assert.equal(b.cls.max, 0.05);
  assert.ok(b.firstTileMs.ceilingMs >= 1000);
  for (const [path, value] of Object.entries(b.js))
    assert.ok(value === null || value > 0, `${path} has a budget of ${value}`);
  assert.ok("recordedAgainst" in b, "a budget must say what it was recorded against");
});

test("every harness script is actually run by something", () => {
  // A check that is added and never run is worse than no check: it reads as
  // coverage on a list and proves nothing. Each script below has to appear in a
  // workflow, and this test is what notices when one quietly stops being called.
  const pkg = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8"));
  const workflows = readdirSync(join(REPO, ".github", "workflows"))
    .map((f) => readFileSync(join(REPO, ".github", "workflows", f), "utf8"))
    .join("\n");
  for (const script of ["test:a11y", "test:contrast", "test:reflow", "test:perf", "test:selftest", "shots"]) {
    assert.ok(pkg.scripts[script], `apps/web/package.json has no "${script}" script`);
    assert.ok(
      workflows.includes(script),
      `"${script}" is in package.json and in no workflow — nothing runs it`,
    );
  }
});

test("the map screenshot is an artifact, not a committed baseline", () => {
  const tracked = execFileSync("git", ["ls-files", "apps/web/e2e/"], { cwd: REPO, encoding: "utf8" });
  assert.ok(
    !tracked.includes("map-render.png"),
    "map-render.png is back in git: 228 KB rewritten by every run, compared against nothing",
  );
  const ignore = readFileSync(join(REPO, ".gitignore"), "utf8");
  assert.match(ignore, /apps\/web\/e2e\/shots\//);
  assert.match(ignore, /map-render\.png/);
});
