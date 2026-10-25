/**
 * The pieces CI's gates rest on, checked without the app: requireServer,
 * which makes a missing server a failure under CI, and the ONLY/WIDTHS slice
 * the pull-request axe and contrast steps run. Each fails quietly when it
 * breaks. A requireServer that skipped under CI would show only as a number
 * in the skip count, and a slice that dropped a route would pass on fewer
 * pages.
 *
 *   node --test test/ci-gates.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { subsetOf, unvisited } from "../e2e/a11y.spec.mjs";
import { AXE_WIDTHS, ROUTES, routesFor } from "../e2e/routes.mjs";

const HELPERS = pathToFileURL(join(import.meta.dirname, "helpers.mjs")).href;
const CI_YML = join(import.meta.dirname, "..", "..", "..", ".github", "workflows", "ci.yml");

/**
 * requireServer in a process of its own, under the environment given. IN_CI
 * and BASE_URL are read when helpers.mjs loads, and it remembers a server it
 * has seen, so one process cannot try both ways. Reports what it returned,
 * what it threw and what it asked to skip.
 */
async function requireServerUnder(env) {
  const code = `
    const { requireServer } = await import(${JSON.stringify(HELPERS)});
    const out = { skips: [] };
    try { out.returned = await requireServer({ skip: (why) => out.skips.push(why) }); }
    catch (e) { out.threw = e.message; }
    console.log(JSON.stringify(out));`;
  const inherited = { ...process.env };
  delete inherited.CI;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...inherited, ...env },
  });
  return JSON.parse(stdout);
}

/** A port nothing listens on: bound by the system, then let go. */
async function closedPort() {
  const server = createTcpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe("requireServer", () => {
  test("under CI, no server is a failure, not a skip", async () => {
    const base = `http://127.0.0.1:${await closedPort()}`;
    const r = await requireServerUnder({ CI: "true", TEST_BASE_URL: base });
    assert.match(r.threw ?? "", /no server at/, "it must throw under CI");
    assert.deepEqual(r.skips, [], "and must not skip as well");
  });

  test("off CI, no server skips the test and says so", async () => {
    const base = `http://127.0.0.1:${await closedPort()}`;
    const r = await requireServerUnder({ TEST_BASE_URL: base });
    assert.equal(r.threw, undefined);
    assert.equal(r.returned, false);
    assert.equal(r.skips.length, 1);
    assert.match(r.skips[0], /no server at/);
  });

  describe("with something listening", () => {
    const server = createServer((_, res) => res.end("ok"));
    after(() => new Promise((resolve) => server.close(resolve)));

    test("it goes ahead, in CI or not", async () => {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      for (const env of [{ CI: "true", TEST_BASE_URL: base }, { TEST_BASE_URL: base }]) {
        const r = await requireServerUnder(env);
        assert.deepEqual(r, { skips: [], returned: true }, JSON.stringify(env));
      }
    });
  });
});

describe("the ONLY/WIDTHS slice", () => {
  test("a name that matches no route is refused", () => {
    const { errors } = subsetOf({ ONLY: "map,nowhere" }, ROUTES, AXE_WIDTHS);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /ONLY names no route: nowhere/);
  });

  for (const widths of ["390px", "0", "390,-1", "phone"]) {
    test(`WIDTHS=${widths} is refused`, () => {
      const { errors } = subsetOf({ WIDTHS: widths }, ROUTES, AXE_WIDTHS);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /WIDTHS is not a list of widths/);
    });
  }

  test("a good slice is read as given, and nothing set means the whole run", () => {
    assert.deepEqual(subsetOf({ ONLY: " map, report ", WIDTHS: "390" }, ROUTES, AXE_WIDTHS), {
      only: ["map", "report"],
      widths: [390],
      partial: true,
      errors: [],
    });
    assert.deepEqual(subsetOf({}, ROUTES, AXE_WIDTHS), {
      only: [],
      widths: AXE_WIDTHS,
      partial: false,
      errors: [],
    });
  });

  test("a named route the run skips fails the slice, with the skip's reason", () => {
    const run = [{ name: "map" }];
    const skipped = [{ name: "login", why: "the form is tested signed out elsewhere" }];
    assert.deepEqual(unvisited(["map", "login"], run, skipped), [
      "ONLY names login, which this run skips: the form is tested signed out elsewhere",
    ]);
    assert.deepEqual(unvisited([], run, skipped), [], "no ONLY is the whole run");
  });

  test("every route CI's slices name is one both checks visit", () => {
    // Read off ci.yml, so renaming a route or giving it a skip fails here,
    // in the unit suite, before the browser step goes quiet on it.
    const slices = [...readFileSync(CI_YML, "utf8").matchAll(/^\s*ONLY: (.+)$/gm)].map((m) =>
      m[1].replace(/^["']|["']$/g, "").split(",").map((s) => s.trim()),
    );
    assert.ok(slices.length >= 2, "ci.yml should set ONLY for the axe and the contrast step");
    for (const only of slices) {
      assert.deepEqual(subsetOf({ ONLY: only.join(",") }, ROUTES, AXE_WIDTHS).errors, []);
      for (const check of ["axe", "contrast"]) {
        const { run, skipped } = routesFor(check, {});
        assert.deepEqual(unvisited(only, run, skipped), [], `${check}: ${only.join(",")}`);
      }
    }
  });
});
