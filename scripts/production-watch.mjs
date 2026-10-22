#!/usr/bin/env node
/**
 * Is production up? Asked every hour by .github/workflows/production-watch.yml.
 *
 *   node scripts/production-watch.mjs              check, then open, update or close the issue
 *   node scripts/production-watch.mjs --dry-run    check and print; no GitHub calls
 *   node scripts/production-watch.mjs target URL   which address verify-deploy should check
 *
 * Until this existed nothing asked production anything on a schedule. Vercel's
 * Hobby plan keeps function logs for about an hour, so a site that broke at
 * night was found broken whenever someone next happened to open it, with the
 * evidence gone.
 *
 * WHAT IT CHECKS, on each address the site answers at:
 *   - /api/health answers 200 with ok and schemaCurrent true, and more than
 *     46,000 reports (production held 46,305 public records on 22 October,
 *     nearly all imported; far fewer means the data, or the view in front of
 *     it, is gone);
 *   - the roadkill report page answers 200 with a Turnstile site key in it or
 *     in the scripts it loads (the key is inlined into a client chunk, not the
 *     HTML; scripts/verify-deploy.mjs has the history of getting that wrong);
 *   - one map tile answers 200 with something in it.
 * Health's other fields (the jobs' ages, the queue, Storage, the database's
 * size) are printed and warned about, not failed on: none has been seen in
 * production yet, so nobody knows what normal looks like there.
 *
 * WHEN IT SAYS SO. One failed run is a blip: a cold start past the timeout, a
 * runner's bad minute. Two in a row open an issue labelled `production-down`,
 * assigned to the repository's owner, which is what makes GitHub send an
 * email. While it stays open a failing run adds a comment only when what is
 * failing changes, or every six hours, so a long outage is not an email an
 * hour. The first green run comments and closes it. "In a row" is read from
 * this workflow's own earlier runs: each run fails exactly when its checks
 * do, so the previous run's conclusion is the previous check's result.
 *
 * The repository is public, so the issue says only what any visitor could
 * see: status codes and the health endpoint's public fields. It never sends
 * the cron secret, so health never names a missing rule here.
 *
 * The decisions are pure functions, exported for apps/web/test/production-watch.test.mjs.
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const HOSTS = ["https://formosawatch.biowatchitnl.org", "https://preservation-web-one.vercel.app"];
export const MIN_REPORTS = 46_000;
export const LABEL = "production-down";
export const REPORT_PAGE = "/report/roadkill";
/** Taipei at zoom 6, as verify-deploy asks for. */
export const TILE = "/api/tiles/6/53/27";
export const RENOTIFY_HOURS = 6;
/** A job whose last good run is older than this is warned about. Every job is daily. */
export const JOB_STALE_HOURS = 36;
const TIMEOUT_MS = 30_000;

/* ------------------------------------------------------------------ *
 * Pure: what a response means
 * ------------------------------------------------------------------ */

/** Why a health answer is not healthy; empty when it is. */
export function healthProblems(status, body) {
  const out = [];
  if (status !== 200) out.push(`answered ${status}`);
  if (!body || typeof body !== "object") return [...out, "no JSON body"];
  if (body.ok !== true) out.push(`ok is ${JSON.stringify(body.ok)}${body.error ? ` (${body.error})` : ""}`);
  if (body.ok === true && body.schemaCurrent !== true) out.push("schemaCurrent is not true");
  if (body.ok === true && !(Number(body.reports) > MIN_REPORTS))
    out.push(`reports ${JSON.stringify(body.reports)}, expected more than ${MIN_REPORTS}`);
  return out;
}

/** Health fields worth a warning that do not fail the run. */
export function healthWarnings(body) {
  const out = [];
  if (!body || body.ok !== true) return out;
  if (body.jobs === null) out.push("jobs: job_runs could not be read");
  for (const [job, v] of Object.entries(body.jobs ?? {})) {
    const h = v?.hoursSinceOk;
    if (h === null || h === undefined) out.push(`${job}: no good run recorded`);
    else if (h > JOB_STALE_HOURS) out.push(`${job}: last good run ${h} h ago`);
  }
  if (body.storage && body.storage.ok !== true) out.push("Storage did not answer");
  return out;
}

/**
 * A Turnstile site key's shape: real keys begin 0x4AAAA; Cloudflare's test
 * keys are 1x, 2x or 3x and twenty zeros. The same pattern as verify-deploy's.
 */
export const TURNSTILE_KEY = /["']0x4AAAA[0-9A-Za-z_-]{10,}["']|["'][123]x0{20}[A-Z]{2}["']/;

/**
 * The page's own script chunks, in order, at most 40. Each must end at a
 * quote, a query or a backslash (the RSC payload escapes its quotes), so a
 * `.json` is not read as a `.js`.
 */
export function scriptsIn(html) {
  const found = html.matchAll(/\/_next\/static\/[^"'\s?\\]+?\.js(?=["'?\\\s])/g);
  return [...new Set([...found].map((m) => m[0]))].slice(0, 40);
}

/** A Vercel deployment URL behind Vercel's login answers 401/403 or redirects to its SSO. */
export function isProtectedDeployment(status, location) {
  if (status === 401 || status === 403) return true;
  return status >= 300 && status < 400 && /vercel\.com\/sso|\/sso-api/.test(location ?? "");
}

/* ------------------------------------------------------------------ *
 * Pure: what to do about it
 * ------------------------------------------------------------------ */

/** What is failing, as a stable string: the same failures give the same key. */
export function failureKey(failures) {
  return [...new Set(failures.map((f) => `${f.host} ${f.name}`))].sort().join("\n");
}

/**
 * The previous check's result, from this workflow's runs (newest first, as
 * GitHub lists them): the newest finished scheduled or manual run other than
 * this one. A cancelled run says nothing, so it is passed over. Null when
 * there is none.
 */
export function previousConclusion(runs, currentRunId) {
  for (const r of runs) {
    if (String(r.id) === String(currentRunId)) continue;
    if (r.status !== "completed") continue;
    if (r.event !== "schedule" && r.event !== "workflow_dispatch") continue;
    if (r.conclusion === "success" || r.conclusion === "failure") return r.conclusion;
  }
  return null;
}

/**
 * The whole policy.
 *
 *   failures      what failed this run ([] when all is well)
 *   previousFailed whether the previous check failed too
 *   issue         the open production-down issue, or null:
 *                   { number, lastKey, lastNotifiedAt }  (ms since epoch)
 *   now           ms since epoch
 *
 * Returns one of: "none" (all well, nothing open), "close" (all well, an issue
 * open), "wait" (first failure), "open", "comment", "quiet" (still failing,
 * already said so recently).
 */
export function decide({ failures, previousFailed, issue, now }) {
  if (failures.length === 0) return issue ? "close" : "none";
  if (!previousFailed) return "wait";
  if (!issue) return "open";
  const changed = issue.lastKey !== failureKey(failures);
  const stale = now - (issue.lastNotifiedAt ?? 0) >= RENOTIFY_HOURS * 3600_000;
  return changed || stale ? "comment" : "quiet";
}

const MARKER = /<!-- production-watch:([A-Za-z0-9_-]*) -->/;

export function marker(failures) {
  return `<!-- production-watch:${Buffer.from(failureKey(failures)).toString("base64url")} -->`;
}

export function keyFromText(text) {
  const m = MARKER.exec(text ?? "");
  return m ? Buffer.from(m[1], "base64url").toString() : null;
}

export function failureList(failures) {
  return failures.map((f) => `- **${f.host}** ${f.name}: ${f.detail}`).join("\n");
}

export function issueBody(failures, runUrl) {
  return [
    `Two scheduled checks in a row found production failing. The latest run: ${runUrl}`,
    "",
    failureList(failures),
    "",
    "What to look at first:",
    "- `/api/health` itself. `schemaCurrent` false means the database is behind the deployed code: run `node scripts/verify-deploy.mjs` with the cron secret to see which migration, then apply it as docs/production-state.md describes.",
    "- Vercel's deployments for the project, and whether the last one finished.",
    "- Supabase's status page, if health answers 503 with `database_unreachable`.",
    "",
    "This issue is updated while it lasts and closed by the first green run. See scripts/production-watch.mjs.",
    "",
    marker(failures),
  ].join("\n");
}

export function commentBody(failures, runUrl) {
  return [`Still failing (${runUrl}):`, "", failureList(failures), "", marker(failures)].join("\n");
}

/* ------------------------------------------------------------------ *
 * Impure: asking production
 * ------------------------------------------------------------------ */

async function get(url, init = {}) {
  return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
}

/** Every check against one address: [{ host, name, ok, detail }], plus health's body. */
export async function checkHost(base) {
  const results = [];
  const add = (name, ok, detail) => results.push({ host: base, name, ok, detail });
  let health = null;

  try {
    const res = await get(`${base}/api/health`);
    health = await res.json().catch(() => null);
    const problems = healthProblems(res.status, health);
    add(
      "health",
      problems.length === 0,
      problems.length ? problems.join("; ") : `${health.reports} reports, ${health.dbLatencyMs} ms`,
    );
  } catch (e) {
    add("health", false, `no answer: ${e.message}`.slice(0, 120));
  }

  try {
    const res = await get(`${base}${REPORT_PAGE}`);
    const html = res.status === 200 ? await res.text() : "";
    let keyed = TURNSTILE_KEY.test(html);
    for (const src of keyed ? [] : scriptsIn(html)) {
      const js = await get(new URL(src, base))
        .then((r) => r.text())
        .catch(() => "");
      if (TURNSTILE_KEY.test(js)) {
        keyed = true;
        break;
      }
    }
    add(
      "report page with Turnstile",
      res.status === 200 && keyed,
      res.status !== 200 ? `answered ${res.status}` : keyed ? "site key present" : "no Turnstile site key in the page or its scripts",
    );
  } catch (e) {
    add("report page with Turnstile", false, `no answer: ${e.message}`.slice(0, 120));
  }

  try {
    const res = await get(`${base}${TILE}`);
    const bytes = res.status === 200 ? (await res.arrayBuffer()).byteLength : 0;
    add("map tile", res.status === 200 && bytes > 0, `answered ${res.status}, ${bytes} bytes`);
  } catch (e) {
    add("map tile", false, `no answer: ${e.message}`.slice(0, 120));
  }

  return { results, health };
}

/* ------------------------------------------------------------------ *
 * Impure: telling GitHub
 * ------------------------------------------------------------------ */

function github() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required (or pass --dry-run)");
  return async function call(path, { method = "GET", body } = {}) {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = new Error(`GitHub ${method} ${path} answered ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  };
}

async function openIssue(gh) {
  const issues = await gh(`/issues?state=open&labels=${LABEL}&per_page=10&sort=created&direction=asc`);
  const issue = issues.find((i) => !i.pull_request);
  if (!issue) return null;
  // The newest marker says what was last reported, and when.
  let lastKey = keyFromText(issue.body);
  let lastNotifiedAt = Date.parse(issue.created_at);
  const comments = await gh(`/issues/${issue.number}/comments?per_page=100`);
  for (const c of comments) {
    const k = keyFromText(c.body);
    if (k !== null) {
      lastKey = k;
      lastNotifiedAt = Date.parse(c.created_at);
    }
  }
  return { number: issue.number, lastKey, lastNotifiedAt };
}

async function act(gh, action, failures, issue, runUrl) {
  if (action === "open") {
    await gh("/labels", {
      method: "POST",
      body: { name: LABEL, color: "b60205", description: "Opened by the hourly production check" },
    }).catch((e) => {
      if (e.status !== 422) throw e; // 422: it exists already
    });
    const issueFields = {
      title: "Production checks are failing",
      body: issueBody(failures, runUrl),
      labels: [LABEL],
    };
    const owner = process.env.GITHUB_REPOSITORY_OWNER;
    const made = await gh("/issues", {
      method: "POST",
      body: owner ? { ...issueFields, assignees: [owner] } : issueFields,
    }).catch((e) => {
      // An owner who cannot be assigned (an organisation) still gets the issue.
      if (e.status === 422 && owner) return gh("/issues", { method: "POST", body: issueFields });
      throw e;
    });
    console.log(`opened #${made.number}`);
  } else if (action === "comment") {
    await gh(`/issues/${issue.number}/comments`, { method: "POST", body: { body: commentBody(failures, runUrl) } });
    console.log(`commented on #${issue.number}`);
  } else if (action === "close") {
    await gh(`/issues/${issue.number}/comments`, {
      method: "POST",
      body: { body: `Every check passed again: ${runUrl}` },
    });
    await gh(`/issues/${issue.number}`, { method: "PATCH", body: { state: "closed", state_reason: "completed" } });
    console.log(`closed #${issue.number}`);
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, lines.join("\n") + "\n");
}

async function target(url) {
  // Vercel's own URL for a production deployment is behind the team's login
  // (ssoProtection all_except_custom_domains), so verify-deploy against it
  // would only ever see the login page. Check that exact deployment when it
  // can be reached, and the production address it was just put behind when
  // it cannot.
  let ok = false;
  try {
    ok = new URL(url).protocol === "https:";
    if (ok) {
      const res = await get(`${url.replace(/\/$/, "")}/api/health`, { redirect: "manual" });
      ok = !isProtectedDeployment(res.status, res.headers.get("location"));
    }
  } catch {
    ok = false;
  }
  console.log(ok ? url.replace(/\/$/, "") : HOSTS[0]);
}

async function main() {
  if (process.argv[2] === "target") return target(process.argv[3] ?? "");
  const dryRun = process.argv.includes("--dry-run");

  const checked = await Promise.all(HOSTS.map((h) => checkHost(h)));
  const results = checked.flatMap((c) => c.results);
  const failures = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? "  ok  " : " FAIL "} ${r.host} ${r.name.padEnd(28)} ${r.detail}`);

  const health = checked[0].health;
  const warnings = healthWarnings(health);
  for (const w of warnings) console.log(`::warning title=production health::${w}`);

  await summary([
    "| | address | check | detail |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.ok ? "ok" : "**FAIL**"} | ${r.host} | ${r.name} | ${r.detail.replace(/\|/g, "\\|")} |`),
    "",
    health?.ok === true
      ? `Jobs: ${JSON.stringify(health.jobs)}; queue: ${JSON.stringify(health.queue)}; Storage: ${JSON.stringify(health.storage)}; database ${health.dbSizeMb} MB.`
      : "",
  ]);

  if (dryRun) {
    process.exitCode = failures.length ? 1 : 0;
    return;
  }

  const gh = github();
  const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const workflow = process.env.WATCH_WORKFLOW ?? "production-watch.yml";
  // Asked per event: every preview deployment's status starts a run of this
  // workflow too (skipped), and an afternoon of pushes would push the last
  // scheduled run off any single page of all runs.
  const runs = [];
  for (const event of ["schedule", "workflow_dispatch"]) {
    const page = await gh(`/actions/workflows/${workflow}/runs?event=${event}&per_page=10&exclude_pull_requests=true`);
    runs.push(...page.workflow_runs);
  }
  runs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const previousFailed = previousConclusion(runs, process.env.GITHUB_RUN_ID) === "failure";
  const issue = await openIssue(gh);
  const action = decide({ failures, previousFailed, issue, now: Date.now() });
  console.log(`previous check ${previousFailed ? "failed" : "passed or none"}; issue ${issue ? `#${issue.number}` : "none"}; ${action}`);
  await act(gh, action, failures, issue, runUrl);

  // The run fails exactly when the checks do, so the next run can read it.
  process.exitCode = failures.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
