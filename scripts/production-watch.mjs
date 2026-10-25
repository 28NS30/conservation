#!/usr/bin/env node
/**
 * Is production up? Asked every hour by .github/workflows/production-watch.yml.
 *
 *   node scripts/production-watch.mjs              check, then open, update or close the issues
 *   node scripts/production-watch.mjs --dry-run    check and print; no GitHub calls
 *   node scripts/production-watch.mjs target URL   which address verify-deploy should check
 *   node scripts/production-watch.mjs wait-for URL SHA
 *                                                  wait until URL serves that commit
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
 * Health's other fields (the queue, Storage, the database's size) are printed
 * and warned about, not failed on: none has been seen in production yet, so
 * nobody knows what normal looks like there. The jobs' ages are warned about
 * too, and feed the jobs-stale issue below.
 *
 * WHEN IT SAYS SO. One failed check is a blip: a cold start past the timeout,
 * a runner's bad minute. Two in a row open an issue labelled
 * `production-down`, assigned to the repository's owner, which is what makes
 * GitHub send an email. While it stays open a failing run adds a comment only
 * when what is failing changes, or every six hours, so a long outage is not
 * an email an hour. The first green run comments and closes it.
 *
 * "In a row" is read from state each run leaves behind, not from whether the
 * run failed. Every run records its own check as a notice annotation titled
 * STATE_TITLE, before it asks GitHub anything, and the next run reads the
 * newest such notice from this workflow's earlier runs (previousState). A run
 * that failed for another reason (GitHub's API answering 5xx, checkout or
 * setup-node failing, the runner timing out) leaves no notice, or a notice
 * saying what the check found, so it is never mistaken for a failed check.
 * And so the run's own result is free to mean something else: it fails only
 * when the issue is opened or commented on, or when a failed check could not
 * be reported, because GitHub emails whoever last edited the schedule about
 * every failed scheduled run, and an email per blip is what the two-in-a-row
 * rule is for.
 *
 * THE JOBS. The same state carries how long each scheduled job has been seen
 * with no good run at all. A job that has gone 48 hours since its last good
 * run, or that the watch has seen with none for 48 hours, opens a separate,
 * quieter issue labelled `jobs-stale`, closed once every job has run well
 * again. That is what notices a job that is refused every night: a route that
 * answers 401 because CRON_SECRET is unset writes no row by design, so its
 * only trace is that no good run ever appears.
 *
 * The repository is public, so the issue says only what any visitor could
 * see: status codes and the health endpoint's public fields. It never sends
 * the cron secret, so health never names a missing rule here.
 *
 * The decisions are pure functions, exported for apps/web/test/production-watch.test.mjs.
 */

import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export const HOSTS = ["https://formosawatch.biowatchitnl.org", "https://preservation-web-one.vercel.app"];
export const MIN_REPORTS = 46_000;
export const LABEL = "production-down";
export const JOBS_LABEL = "jobs-stale";
/** The workflow's job that runs this; its runs' annotations are where the state is read. */
export const WATCH_JOB = "watch";
export const STATE_TITLE = "production-watch state";
export const REPORT_PAGE = "/report/roadkill";
/** Taipei at zoom 6, as verify-deploy asks for. */
export const TILE = "/api/tiles/6/53/27";
export const RENOTIFY_HOURS = 6;
/** A job whose last good run is older than this is warned about. Every job is daily. */
export const JOB_STALE_HOURS = 36;
/** ...and opens the jobs-stale issue past this, as does a job seen with no good run for as long. */
export const JOB_ALARM_HOURS = 48;
/** How many earlier runs are asked for the state before giving up on it. */
const STATE_RUNS = 5;
/** How long the deploy check waits for the address to serve the new commit. */
const WAIT_FOR_COMMIT_MS = 180_000;
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

/* What one run leaves for the next. */

/**
 * The notice that records this run's state, as a workflow command. The state
 * is { failed, nullSince }: whether the check failed, and since when (ms since
 * epoch) the watch has seen each job with no good run.
 */
export function stateCommand(state) {
  const message = JSON.stringify(state).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return `::notice title=${STATE_TITLE}::${message}`;
}

/** The state in a run's annotations, or null if it left none that reads as one. */
export function stateFromAnnotations(annotations) {
  for (const a of annotations ?? []) {
    if (a?.title !== STATE_TITLE) continue;
    try {
      const s = JSON.parse(a.message);
      if (typeof s?.failed !== "boolean") continue;
      const nullSince = {};
      for (const [job, at] of Object.entries(s.nullSince ?? {}))
        if (/^[a-z][a-z0-9-]{0,39}$/.test(job) && Number.isFinite(at)) nullSince[job] = at;
      return { failed: s.failed, nullSince };
    } catch {
      /* not one of ours */
    }
  }
  return null;
}

/**
 * The previous run's state: the newest finished scheduled or manual run,
 * other than this one, that left one, looking at no more than STATE_RUNS
 * runs. `runs` is newest first; `annotationsOf(run)` fetches a run's
 * annotations. Null when none of them left a state (the first runs, or a
 * stretch in which every run failed before it could record one), which reads
 * as "the previous check did not fail": the rule errs towards one email too
 * few rather than one too many, and the next run has a state again.
 */
export async function previousState(runs, currentRunId, annotationsOf) {
  let asked = 0;
  for (const r of runs) {
    if (String(r.id) === String(currentRunId)) continue;
    if (r.status !== "completed") continue;
    if (r.event !== "schedule" && r.event !== "workflow_dispatch") continue;
    if (++asked > STATE_RUNS) break;
    const state = stateFromAnnotations(await annotationsOf(r));
    if (state) return state;
  }
  return null;
}

/**
 * The jobs that have gone too long without a good run, from health's `jobs`
 * and the previous run's `nullSince`.
 *
 * Health says how long since a job's last good run, or null when it has none
 * on record, which is also what it says on the first day after 0036 is
 * applied. So a null opens the issue only once the watch has seen it for
 * JOB_ALARM_HOURS, counted from the first run that saw it. `known` is false
 * when health cannot say (it failed, or 0036 is not applied, `jobs: null`),
 * and then nothing is opened or closed and the clock is carried over.
 */
export function staleJobs(body, nullSince, now) {
  if (body?.ok !== true || !body.jobs || typeof body.jobs !== "object")
    return { known: false, stale: [], nullSince: { ...(nullSince ?? {}) } };
  const stale = [];
  const next = {};
  for (const [job, v] of Object.entries(body.jobs)) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(job)) continue;
    const h = v?.hoursSinceOk;
    if (typeof h === "number") {
      if (h > JOB_ALARM_HOURS) stale.push({ job, detail: `last good run ${h} h ago` });
      continue;
    }
    const since = Number.isFinite(nullSince?.[job]) ? nullSince[job] : now;
    next[job] = since;
    const seen = Math.floor((now - since) / 3600_000);
    if (seen >= JOB_ALARM_HOURS) stale.push({ job, detail: `no good run on record, in the ${seen} h the watch has looked` });
  }
  return { known: true, stale, nullSince: next };
}

/** What to do about the jobs-stale issue: "open", "comment" (a different set), "close" or "none". */
export function decideJobs({ known, stale, issue }) {
  if (!known) return "none";
  if (!stale.length) return issue ? "close" : "none";
  if (!issue) return "open";
  return issue.lastKey === jobsKey(stale) ? "none" : "comment";
}

export function jobsKey(stale) {
  return [...new Set(stale.map((s) => s.job))].sort().join("\n");
}

/**
 * Whether this run fails. Only when it told the issue something new, or when
 * a failed check could not be reported: then a failed run, and GitHub's own
 * email about it, is the only way anyone hears.
 */
export function exitCode({ failures, action, reported }) {
  if (!reported) return failures.length ? 1 : 0;
  return action === "open" || action === "comment" ? 1 : 0;
}

/**
 * Whether health's `commit` is the deployment's: "same", "different", or
 * "unknown" when health does not say (a build from before it did, or Vercel
 * not exposing VERCEL_GIT_COMMIT_SHA).
 */
export function commitMatch(served, sha) {
  if (typeof served !== "string" || !/^[0-9a-f]{12,40}$/.test(served)) return "unknown";
  return String(sha).toLowerCase().startsWith(served) ? "same" : "different";
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

/** A hidden comment carrying what an issue or comment last reported. */
export function markerOf(key) {
  return `<!-- production-watch:${Buffer.from(key).toString("base64url")} -->`;
}

export function marker(failures) {
  return markerOf(failureKey(failures));
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

export function jobsList(stale) {
  return stale.map((s) => `- \`${s.job}\`: ${s.detail}`).join("\n");
}

export function jobsIssueBody(stale, runUrl) {
  return [
    `Scheduled jobs that have gone ${JOB_ALARM_HOURS} hours without a good run, as /api/health reports them. The latest check: ${runUrl}`,
    "",
    jobsList(stale),
    "",
    "Every job runs daily (apps/web/vercel.json). What to look at first:",
    "- Whether `CRON_SECRET` is set in Vercel's production environment. Without it every job answers 401, and a refused run records nothing.",
    "- Vercel's Cron Jobs page for the project, and the job's route called by hand with the secret.",
    "- `job_runs` in the database: an unfinished row is a run killed at its time limit, `ok` false a run that failed.",
    "",
    "Closed by the first check that finds every job has run well again. See scripts/production-watch.mjs.",
    "",
    markerOf(jobsKey(stale)),
  ].join("\n");
}

export function jobsCommentBody(stale, runUrl) {
  return [`Now (${runUrl}):`, "", jobsList(stale), "", markerOf(jobsKey(stale))].join("\n");
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

/** The open issue with this label: { number, lastKey, lastNotifiedAt }, or null. */
async function openIssue(gh, label) {
  const issues = await gh(`/issues?state=open&labels=${label}&per_page=10&sort=created&direction=asc`);
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

async function createIssue(gh, label, { color, description, title, body }) {
  await gh("/labels", { method: "POST", body: { name: label, color, description } }).catch((e) => {
    if (e.status !== 422) throw e; // 422: it exists already
  });
  const fields = { title, body, labels: [label] };
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  const made = await gh("/issues", {
    method: "POST",
    body: owner ? { ...fields, assignees: [owner] } : fields,
  }).catch((e) => {
    // An owner who cannot be assigned (an organisation) still gets the issue.
    if (e.status === 422 && owner) return gh("/issues", { method: "POST", body: fields });
    throw e;
  });
  console.log(`opened #${made.number} (${label})`);
}

async function comment(gh, issue, body) {
  await gh(`/issues/${issue.number}/comments`, { method: "POST", body: { body } });
  console.log(`commented on #${issue.number}`);
}

async function close(gh, issue, body) {
  await comment(gh, issue, body);
  await gh(`/issues/${issue.number}`, { method: "PATCH", body: { state: "closed", state_reason: "completed" } });
  console.log(`closed #${issue.number}`);
}

async function act(gh, action, failures, issue, runUrl) {
  if (action === "open")
    await createIssue(gh, LABEL, {
      color: "b60205",
      description: "Opened by the hourly production check",
      title: "Production checks are failing",
      body: issueBody(failures, runUrl),
    });
  else if (action === "comment") await comment(gh, issue, commentBody(failures, runUrl));
  else if (action === "close") await close(gh, issue, `Every check passed again: ${runUrl}`);
}

async function actOnJobs(gh, action, stale, issue, runUrl) {
  if (action === "open")
    await createIssue(gh, JOBS_LABEL, {
      color: "fbca04",
      description: "Opened by the hourly production check: a scheduled job has stopped succeeding",
      title: "A scheduled job has not run well for two days",
      body: jobsIssueBody(stale, runUrl),
    });
  else if (action === "comment") await comment(gh, issue, jobsCommentBody(stale, runUrl));
  else if (action === "close") await close(gh, issue, `Every job has run well again: ${runUrl}`);
}

/** A run's annotations, read from its watch job's check run. */
function annotationsOf(gh) {
  return async (run) => {
    const { jobs } = await gh(`/actions/runs/${run.id}/jobs?filter=latest&per_page=20`);
    const job = jobs.find((j) => j.name === WATCH_JOB);
    const id = /\/check-runs\/(\d+)$/.exec(job?.check_run_url ?? "")?.[1];
    return id ? gh(`/check-runs/${id}/annotations?per_page=50`) : [];
  };
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

/**
 * Wait until `url` serves the commit `sha`, for the deploy check: the address
 * can still point at the previous deployment for a moment, and verify-deploy
 * run then would pass or fail the wrong build. Exits 1 if it serves another
 * commit throughout; carries on with a warning if health never says which it
 * serves (a build from before it did, or VERCEL_GIT_COMMIT_SHA not exposed)
 * or never answers (verify-deploy then reports that itself).
 */
async function waitFor(url, sha) {
  const want = String(sha ?? "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(want)) {
    console.log("::warning title=deploy check::no deployment commit given; not waiting for it");
    return;
  }
  const deadline = Date.now() + WAIT_FOR_COMMIT_MS;
  let match = "unanswered";
  let served = null;
  for (;;) {
    try {
      const body = await (await get(`${url}/api/health`)).json();
      served = body?.commit ?? null;
      match = commitMatch(served, want);
    } catch {
      /* not answering yet */
    }
    if (match === "same") return console.log(`${url} serves ${want.slice(0, 12)}`);
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 15_000));
  }
  const minutes = WAIT_FOR_COMMIT_MS / 60_000;
  if (match === "different") {
    console.error(
      `${url} still serves ${served} after ${minutes} minutes, not ${want.slice(0, 12)}: the address was not moved to this deployment, or a newer one replaced it. See Vercel's deployments.`,
    );
    process.exitCode = 1;
  } else if (match === "unknown") {
    console.log(`::warning title=deploy check::${url} does not say which commit it serves; checking it without knowing`);
  } else {
    console.log(`::warning title=deploy check::${url} did not answer /api/health for ${minutes} minutes`);
  }
}

async function main() {
  if (process.argv[2] === "target") return target(process.argv[3] ?? "");
  if (process.argv[2] === "wait-for") return waitFor((process.argv[3] ?? "").replace(/\/$/, ""), process.argv[4]);
  const dryRun = process.argv.includes("--dry-run");

  const checked = await Promise.all(HOSTS.map((h) => checkHost(h)));
  const results = checked.flatMap((c) => c.results);
  const failures = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? "  ok  " : " FAIL "} ${r.host} ${r.name.padEnd(28)} ${r.detail}`);
  for (const f of failures) console.log(`::error title=production check::${f.host} ${f.name}: ${f.detail}`);

  const health = checked[0].health;
  const warnings = healthWarnings(health);
  for (const w of warnings) console.log(`::warning title=production health::${w}`);

  await summary([
    "| | address | check | detail |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.ok ? "ok" : "**FAIL**"} | ${r.host} | ${r.name} | ${r.detail.replace(/\|/g, "\\|")} |`),
    "",
    health?.ok === true
      ? `Jobs: ${JSON.stringify(health.jobs)}; queue: ${JSON.stringify(health.queue)}; Storage: ${JSON.stringify(health.storage)}; database ${health.dbSizeMb} MB; commit ${health.commit}.`
      : "",
  ]);

  if (dryRun) {
    const jobs = staleJobs(health, {}, Date.now());
    console.log(stateCommand({ failed: failures.length > 0, nullSince: jobs.nullSince }));
    process.exitCode = failures.length ? 1 : 0;
    return;
  }

  const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const now = Date.now();
  let gh = null;
  let previous = null;
  let reported = true;
  const fault = (what, e) => {
    reported = false;
    console.log(`::error title=production watch::${what}: ${String(e?.message ?? e).slice(0, 200)}`);
  };

  // The previous run's state first, because this run's state carries its clock on.
  try {
    gh = github();
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
    previous = await previousState(runs, process.env.GITHUB_RUN_ID, annotationsOf(gh));
  } catch (e) {
    fault("could not read the previous check", e);
  }

  // Recorded before anything else is asked of GitHub, so whatever fails next
  // the next run knows what this one found.
  const jobs = staleJobs(health, previous?.nullSince, now);
  console.log(stateCommand({ failed: failures.length > 0, nullSince: jobs.nullSince }));

  let action = "none";
  if (gh) {
    try {
      const issue = await openIssue(gh, LABEL);
      action = decide({ failures, previousFailed: previous?.failed === true, issue, now });
      console.log(
        `previous check ${previous ? (previous.failed ? "failed" : "passed") : "unknown"}; issue ${issue ? `#${issue.number}` : "none"}; ${action}`,
      );
      await act(gh, action, failures, issue, runUrl);
    } catch (e) {
      fault("could not open, update or close the production-down issue", e);
    }
    try {
      const issue = await openIssue(gh, JOBS_LABEL);
      const jobsAction = decideJobs({ known: jobs.known, stale: jobs.stale, issue });
      if (jobsAction !== "none") console.log(`jobs: ${jobsAction}`);
      await actOnJobs(gh, jobsAction, jobs.stale, issue, runUrl);
    } catch (e) {
      // The jobs' issue is the quieter one; failing to update it does not fail the run.
      console.log(`::warning title=production watch::could not update the jobs-stale issue: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }

  process.exitCode = exitCode({ failures, action, reported });
}

/** Run directly, as `node scripts/production-watch.mjs`, through any symlink in the path. */
function isMain() {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
