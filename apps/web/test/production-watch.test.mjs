/**
 * The hourly production watch's policy (scripts/production-watch.mjs,
 * .github/workflows/production-watch.yml).
 *
 * The point of the watch is an email when production is down, and only then.
 * Both halves can fail quietly: a rule that opens an issue on every blip gets
 * its emails filtered within a week, and one that never opens it is the
 * silence it replaced. So the decisions are pure functions and are pinned
 * here: one failure waits, two open an issue, a long outage is not an email
 * an hour, and the first green run closes it.
 *
 * The runtime half runs the real checks against the local server, when there
 * is one.
 *
 *   node --test test/production-watch.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL } from "./helpers.mjs";
import {
  HOSTS,
  MIN_REPORTS,
  RENOTIFY_HOURS,
  TURNSTILE_KEY,
  checkHost,
  commentBody,
  decide,
  failureKey,
  healthProblems,
  healthWarnings,
  isProtectedDeployment,
  issueBody,
  keyFromText,
  marker,
  previousConclusion,
  scriptsIn,
} from "../../../scripts/production-watch.mjs";

const REPO = join(import.meta.dirname, "..", "..", "..");
const up = async () => Boolean(await fetch(BASE_URL).catch(() => null));

const HOUR = 3600_000;
const now = Date.parse("2026-10-22T03:23:00Z");
const down = [{ host: HOSTS[0], name: "health", ok: false, detail: "answered 503" }];
const alsoTiles = [...down, { host: HOSTS[1], name: "map tile", ok: false, detail: "answered 500, 0 bytes" }];

describe("when to say something", () => {
  test("all well and nothing open: nothing", () => {
    assert.equal(decide({ failures: [], previousFailed: false, issue: null, now }), "none");
    assert.equal(decide({ failures: [], previousFailed: true, issue: null, now }), "none");
  });

  test("one failure is a blip: wait for the next run", () => {
    assert.equal(decide({ failures: down, previousFailed: false, issue: null, now }), "wait");
    // Even with an issue somehow open: the rule is two in a row, whoever opened it.
    const issue = { number: 7, lastKey: null, lastNotifiedAt: now - 24 * HOUR };
    assert.equal(decide({ failures: down, previousFailed: false, issue, now }), "wait");
  });

  test("two in a row open the issue", () => {
    assert.equal(decide({ failures: down, previousFailed: true, issue: null, now }), "open");
  });

  test("an open issue hears again only when something changes, or every six hours", () => {
    const said = { number: 7, lastKey: failureKey(down), lastNotifiedAt: now - HOUR };
    assert.equal(decide({ failures: down, previousFailed: true, issue: said, now }), "quiet");
    assert.equal(decide({ failures: alsoTiles, previousFailed: true, issue: said, now }), "comment");
    const longAgo = { ...said, lastNotifiedAt: now - RENOTIFY_HOURS * HOUR };
    assert.equal(decide({ failures: down, previousFailed: true, issue: longAgo, now }), "comment");
  });

  test("the first green run closes it", () => {
    const issue = { number: 7, lastKey: failureKey(down), lastNotifiedAt: now - HOUR };
    assert.equal(decide({ failures: [], previousFailed: true, issue, now }), "close");
  });

  test("the same failures give the same key, in any order and with any detail", () => {
    const shuffled = [{ ...alsoTiles[1], detail: "answered 502" }, { ...alsoTiles[0], detail: "timeout" }];
    assert.equal(failureKey(shuffled), failureKey(alsoTiles));
    assert.notEqual(failureKey(down), failureKey(alsoTiles));
  });

  test("the key survives a round trip through the issue's text", () => {
    assert.equal(keyFromText(issueBody(alsoTiles, "https://example.test/run/1")), failureKey(alsoTiles));
    assert.equal(keyFromText(commentBody(down, "https://example.test/run/2")), failureKey(down));
    assert.equal(keyFromText("a comment someone typed"), null);
    assert.doesNotMatch(marker(alsoTiles), /--.*--.*--/, "an HTML comment cannot hold a second --");
  });
});

describe("what the previous run says", () => {
  const run = (id, event, status, conclusion) => ({ id, event, status, conclusion });

  test("the newest finished scheduled or manual run, other than this one", () => {
    const runs = [
      run(9, "schedule", "in_progress", null), // this run
      run(8, "deployment_status", "completed", "success"),
      run(7, "schedule", "completed", "cancelled"),
      run(6, "workflow_dispatch", "completed", "failure"),
      run(5, "schedule", "completed", "success"),
    ];
    assert.equal(previousConclusion(runs, "9"), "failure");
    assert.equal(previousConclusion(runs.slice(4), 9), "success");
    assert.equal(previousConclusion([run(9, "schedule", "in_progress", null)], 9), null);
  });
});

describe("what a response means", () => {
  const healthy = { ok: true, schemaCurrent: true, reports: 46_334, dbLatencyMs: 80 };

  test("a healthy answer has no problems", () => {
    assert.deepEqual(healthProblems(200, healthy), []);
  });

  test("each way of being unhealthy is named", () => {
    assert.deepEqual(healthProblems(503, { ok: false, error: "database_unreachable" }), [
      "answered 503",
      'ok is false (database_unreachable)',
    ]);
    assert.deepEqual(healthProblems(503, { ...healthy, schemaCurrent: false }), [
      "answered 503",
      "schemaCurrent is not true",
    ]);
    assert.deepEqual(healthProblems(200, { ...healthy, reports: MIN_REPORTS }), [
      `reports ${MIN_REPORTS}, expected more than ${MIN_REPORTS}`,
    ]);
    assert.deepEqual(healthProblems(502, null), ["answered 502", "no JSON body"]);
  });

  test("health's other fields warn and do not fail", () => {
    const body = {
      ...healthy,
      jobs: { classify: { hoursSinceOk: 50 }, "cleanup-orphans": { hoursSinceOk: null } },
      storage: { ok: false },
    };
    assert.deepEqual(healthProblems(200, body), []);
    assert.deepEqual(healthWarnings(body), [
      "classify: last good run 50 h ago",
      "cleanup-orphans: no good run recorded",
      "Storage did not answer",
    ]);
    assert.deepEqual(healthWarnings({ ...healthy, jobs: { classify: { hoursSinceOk: 3 } }, storage: { ok: true } }), []);
  });

  test("a Turnstile key is recognised by its shape, and an empty one is not", () => {
    assert.ok(TURNSTILE_KEY.test('sitekey:"0x4AAAAAAAabcdefghijklmn"'));
    assert.ok(TURNSTILE_KEY.test('let n="1x00000000000000000000AA"'));
    assert.ok(!TURNSTILE_KEY.test('sitekey:""'));
    assert.ok(!TURNSTILE_KEY.test("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"));
  });

  test("the page's scripts are found, and a .json is not one", () => {
    const html = `<script src="/_next/static/chunks/a.js" async></script>
      "/_next/static/x/_buildManifest.json" \\"/_next/static/chunks/b.js\\" "/_next/static/chunks/a.js"`;
    assert.deepEqual(scriptsIn(html), ["/_next/static/chunks/a.js", "/_next/static/chunks/b.js"]);
  });

  test("a deployment behind Vercel's login is recognised", () => {
    assert.ok(isProtectedDeployment(401, null));
    assert.ok(isProtectedDeployment(302, "https://vercel.com/sso-api?url=x"));
    assert.ok(!isProtectedDeployment(200, null));
    assert.ok(!isProtectedDeployment(307, "/en"));
  });
});

describe("the workflow", () => {
  const yml = readFileSync(join(REPO, ".github", "workflows", "production-watch.yml"), "utf8");

  test("runs hourly, by hand, and on deployments", () => {
    assert.match(yml, /- cron: "\d+ \* \* \* \*"/);
    assert.match(yml, /^  workflow_dispatch:$/m);
    assert.match(yml, /^  deployment_status:$/m);
  });

  test("the run fails exactly when the checks do, so the keepalive cannot fail it", () => {
    const keepalive = yml.slice(yml.indexOf("- name: Keep the schedule alive"), yml.indexOf("verify-deploy:"));
    assert.match(keepalive, /continue-on-error: true/);
    assert.match(keepalive, /actions\/workflows\/production-watch\.yml\/enable/);
  });

  test("checks production deployments only, and puts no event text in a command", () => {
    assert.match(yml, /github\.event\.deployment\.environment == 'Production'/);
    assert.match(yml, /github\.event\.deployment_status\.state == 'success'/);
    // Every `run:`, one line or a block: an event's text belongs in `env:`.
    const lines = yml.split("\n");
    const scripts = [];
    lines.forEach((l, i) => {
      const m = /^(\s*)(?:- )?run: ?(.*)$/.exec(l);
      if (!m) return;
      scripts.push(m[2]);
      if (m[2] === "|")
        for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || lines[j].search(/\S/) > m[1].length); j++)
          scripts.push(lines[j]);
    });
    assert.ok(scripts.some((s) => s.includes("verify-deploy.mjs")), "the verify step was not found");
    for (const s of scripts)
      assert.doesNotMatch(s, /\$\{\{/, `an expression is interpolated into a script: ${s.trim()}`);
  });

  test("sends no secret but its own token", () => {
    assert.doesNotMatch(yml, /secrets\./);
  });
});

describe("against the running server", () => {
  test("health and the tile pass; the report page answers", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const { results, health } = await checkHost(BASE_URL.replace(/\/$/, ""));
    const by = Object.fromEntries(results.map((r) => [r.name, r]));
    // The local database holds the same 46,000-odd imported records as production.
    assert.ok(by.health.ok, by.health.detail);
    assert.ok(by["map tile"].ok, by["map tile"].detail);
    // Locally the Turnstile keys are empty on purpose, so only the page itself is asked for.
    assert.doesNotMatch(by["report page with Turnstile"].detail, /^answered|^no answer/);
    assert.equal(health.ok, true);
  });
});
