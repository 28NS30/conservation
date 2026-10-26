import { forumEnabled, type ForumEnv } from "./forum/gate.ts";

/**
 * The pure half of the site's monitoring: what /api/health answers, what a job
 * run records, and what an error row may contain.
 *
 * Kept free of the database and of `@/` imports so the rules can be tested
 * with plain `node --test` (test/monitoring.test.mjs). The halves that touch
 * the database are lib/jobRuns.ts and lib/appErrors.ts.
 */

/**
 * The scheduled jobs, by the name each records in `job_runs`: the last segment
 * of its path under /api/jobs, which is how apps/web/vercel.json names it.
 * test/monitoring.test.mjs holds this list equal to the crons.
 */
export const JOBS = ["classify", "cleanup-orphans", "forum-retention"] as const;
export type JobName = (typeof JOBS)[number];

/**
 * The jobs this deployment runs. The forum's answers 404 while the forum is
 * off and records nothing, so asking after it then would report a job that is
 * not there as one that never succeeds.
 */
export function activeJobs(env: ForumEnv = process.env): JobName[] {
  return JOBS.filter((j) => j !== "forum-retention" || forumEnabled(env));
}

/** The longest `detail` the table accepts (0036). */
export const DETAIL_MAX = 300;

/**
 * The three statements lib/jobRuns.ts runs, here so that
 * test/monitoring-tables.test.mjs runs these very statements against the
 * table. $1 is the job's name; for the second, $1 the run's id, $2 ok and $3
 * the detail; the third takes the job names as an array.
 */
export const JOB_RUN_START = `insert into job_runs (job) values ($1) returning id`;
export const JOB_RUN_FINISH = `update job_runs set finished_at = now(), ok = $2, detail = $3 where id = $1`;
export const JOB_RUN_AGES = `
  select job, extract(epoch from now() - max(finished_at))::float8 as seconds
    from job_runs
   where ok and job = any($1::text[])
   group by job`;

/**
 * What the classification worker would still claim (lib/report/classifyWorker.ts):
 * queued or failed jobs, and running ones whose lease has gone stale, under
 * the attempt limit, for a report a moderator has not rejected. The same
 * predicate as the worker's claim, so `waiting` is work that will happen and
 * `oldestMinutes` cannot grow for ever on a job nothing will ever take (a
 * rejected report's job is never claimed and never cancelled).
 * test/monitoring.test.mjs holds the two constants equal to the worker's;
 * $1 is QUEUE_MAX_ATTEMPTS and $2 QUEUE_STALE_AFTER.
 */
export const QUEUE_MAX_ATTEMPTS = 5;
export const QUEUE_STALE_AFTER = "5 minutes";
export const CLASSIFICATION_QUEUE = `
  select count(*)::int as waiting,
         extract(epoch from now() - min(j.created_at))::float8 as oldest_seconds
    from classification_jobs j
   where (j.status in ('queued', 'failed')
          or (j.status = 'running' and j.updated_at < now() - $2::interval))
     and j.attempts < $1
     and exists (select 1 from reports r where r.id = j.report_id and r.status <> 'rejected')`;

/**
 * What a run records about itself: the route's own JSON answer, which every
 * job keeps to counts and an error code, cut to fit.
 */
export function jobDetail(text: string): string {
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

/**
 * What a run that threw records: the error's class and code, never its
 * message. A Postgres message can quote the value that failed ("invalid input
 * syntax for type uuid: ..."), and the message is in the function log, which
 * is where a person debugging it will look anyway.
 */
export function errorDetail(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e;
  const code = (e as { code?: unknown } | null)?.code;
  const safeCode = typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code) ? ` ${code}` : "";
  return jobDetail(`threw ${name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 60) || "error"}${safeCode}`);
}

/** New (route, digest) rows one hour may gain; counts on existing rows still go up. */
export const APP_ERRORS_PER_HOUR = 200;

/**
 * Add one to this hour's row for $1 (route) and $2 (digest), making the row
 * if the hour has fewer than $3 rows. Here rather than in lib/appErrors.ts so
 * test/monitoring-tables.test.mjs runs this very statement. The hour is cut in
 * UTC so it means the same in every session's time zone.
 */
export const APP_ERROR_UPSERT = `
  with h as (select date_trunc('hour', now(), 'UTC') as hour)
  insert into app_errors (route, digest, hour)
  select $1, $2, h.hour from h
   where exists (select 1 from app_errors e
                  where e.hour = h.hour and e.route = $1 and e.digest = $2)
      or (select count(*) from app_errors e where e.hour = h.hour) < $3
  on conflict (hour, route, digest) do update set count = app_errors.count + 1`;
/** How long app_errors and job_runs rows are kept (the cleanup job's purge). */
export const APP_ERRORS_RETENTION = "30 days";
export const JOB_RUNS_RETENTION = "90 days";

/**
 * The only two things an error row records.
 *
 * The route is the pattern Next.js names in onRequestError's context, such as
 * "/[locale]/(site)/reports/[id]", never the request's own path: that carries
 * record ids, search terms and, on the sign-in callback, codes. The digest is
 * the hash Next.js prints on the error page, so a person who reports "it said
 * 1234567890" can be matched to a row; route handlers have none, so it is ''.
 * Anything that is not plainly one of those becomes a fixed word rather than
 * being stored.
 */
export function requestErrorKey(err: unknown, context: unknown): { route: string; digest: string } {
  const routePath = (context as { routePath?: unknown } | null)?.routePath;
  const route =
    typeof routePath === "string" && /^\/[\w\-[\]().@/]{0,199}$/.test(routePath) ? routePath : "unknown";
  const raw = (err as { digest?: unknown } | null)?.digest;
  const digest =
    raw === undefined || raw === null || raw === ""
      ? ""
      : typeof raw === "string" && /^[\w;:.-]{1,64}$/.test(raw)
        ? raw
        : "other";
  return { route, digest };
}

type WaitUntil = (task: Promise<unknown>) => void;
type RequestContextHolder = { get?: () => { waitUntil?: unknown } | undefined };

/**
 * The platform's `waitUntil` for the request being answered, or null where
 * there is none (`next start`, a test).
 *
 * Next.js awaits onRequestError for a route handler or a server action, but
 * for an error while rendering a page it is called from React's error
 * callback, whose answer nothing awaits. On Vercel the function can be frozen
 * as soon as the response is sent, so a write still in flight then is lost.
 * Handing it to `waitUntil` keeps the invocation alive until it ends.
 *
 * Read from the two request contexts Vercel's runtime provides: Next.js's own,
 * which is where its `after()` gets `waitUntil` from (server/after/
 * builtin-request-context.js, the same in 16.3 and 16.4), and Vercel's, which
 * is what `@vercel/functions` reads. Both are looked up by a global symbol and
 * guarded, so a release that drops either finds null here and the write falls
 * back to being awaited, as it was before. Must be called while the request is
 * being answered: each context is per request.
 */
export function platformWaitUntil(scope: object = globalThis): WaitUntil | null {
  for (const name of ["@next/request-context", "@vercel/request-context"]) {
    try {
      const holder = (scope as Record<symbol, RequestContextHolder | undefined>)[Symbol.for(name)];
      const ctx = holder?.get?.();
      const waitUntil = ctx?.waitUntil;
      if (typeof waitUntil === "function")
        return (task) => {
          try {
            waitUntil.call(ctx, task);
          } catch {
            /* the task still runs; it is only not waited for */
          }
        };
    } catch {
      /* not this one */
    }
  }
  return null;
}

/**
 * `fn`'s answer, kept for `ms` by this server instance; a failure is not kept.
 * Calls while one is in flight share it. For /api/health's costly parts, so a
 * request the CDN does not answer (any query string is a new cache key, any
 * Authorization header skips it) costs a few queries rather than thirty.
 */
export function memoFor<T>(ms: number, fn: () => Promise<T>, now: () => number = Date.now): () => Promise<T> {
  let at = 0;
  let kept: Promise<T> | null = null;
  return () => {
    if (kept && now() - at < ms) return kept;
    at = now();
    const p = fn();
    kept = p;
    p.catch(() => {
      if (kept === p) kept = null;
    });
    return p;
  };
}

/** The commit a deployment was built from, shortened; null when it is not known. */
export function commitOf(sha: string | undefined): string | null {
  return typeof sha === "string" && /^[0-9a-f]{12,40}$/.test(sha) ? sha.slice(0, 12) : null;
}

/** Hours, to one decimal: what the health endpoint reports a job's age in. */
export function hours(seconds: number | null): number | null {
  return seconds === null || !Number.isFinite(seconds) ? null : Math.round(seconds / 360) / 10;
}

export type HealthInput = {
  counts: { reports: number; taxa: number; species: number };
  schema: { current: boolean; missing: string[] };
  /** The request carried the cron secret. */
  operator: boolean;
  /** The request carried any Authorization header at all. */
  authorization: boolean;
  /** The jobs to report on (activeJobs()). */
  jobs: JobName[];
  /** Seconds since each job's last good run; a job with none has no key. Null if unreadable. */
  jobSeconds: Partial<Record<JobName, number | null>> | null;
  /** Null if unreadable. */
  queue: { waiting: number; oldestSeconds: number | null } | null;
  storageOk: boolean;
  dbSizeMb: number | null;
  latencyMs: number;
  /** commitOf(VERCEL_GIT_COMMIT_SHA): which build is answering. */
  commit: string | null;
};

export type HealthResponse = { status: number; headers: Record<string, string>; body: Record<string, unknown> };

/**
 * What /api/health answers once the database has answered.
 *
 * Every field is an aggregate: counts, ages and sizes, never a row. The
 * fields verify-deploy, CI and the parent site read (`ok`, `schemaCurrent`,
 * `reports`, `taxa`, `species`, `dbLatencyMs`) keep their names and meaning.
 *
 * 503 when the schema is not current. A deployment whose database is behind
 * the code still renders every page, so a status anyone's monitor reads has to
 * say so, not only a field one has to know to look for; `ok` stays true
 * because the database did answer, which is what it has always meant.
 *
 * `commit` is the commit the answering build was made from, so the deploy
 * check can tell that the address it asks is serving the deployment it was
 * started for (the repository is public; the commit is no secret).
 *
 * Cached by the CDN for 30 seconds when it is a plain public 200, so a crawler
 * or a monitor polling the plain address is answered without the database.
 * That is not a defence: any query string is a new cache key, and a request
 * with an Authorization header skips the cache, so the route also keeps its
 * costly parts for 30 seconds itself (memoFor). Never cached by the CDN when
 * it is not a 200, or when the request carried an Authorization header: the
 * operator's answer names missing rules, and a
 * shared cache that kept it would hand those names to the next visitor (the
 * 29 September audit's finding, back again). `Vary: Authorization` keeps a
 * cached public answer from being served to the operator instead.
 */
export function healthResponse(input: HealthInput): HealthResponse {
  const status = input.schema.current ? 200 : 503;
  const jobs = input.jobSeconds
    ? Object.fromEntries(input.jobs.map((j) => [j, { hoursSinceOk: hours(input.jobSeconds?.[j] ?? null) }]))
    : null;
  const body: Record<string, unknown> = {
    ok: true,
    schemaCurrent: input.schema.current,
    ...(input.schema.missing.length && input.operator ? { schemaMissing: input.schema.missing } : {}),
    reports: input.counts.reports,
    taxa: input.counts.taxa,
    species: input.counts.species,
    jobs,
    queue: input.queue
      ? {
          waiting: input.queue.waiting,
          oldestMinutes:
            input.queue.oldestSeconds === null ? null : Math.round(input.queue.oldestSeconds / 60),
        }
      : null,
    storage: { ok: input.storageOk },
    dbSizeMb: input.dbSizeMb,
    dbLatencyMs: input.latencyMs,
    commit: input.commit,
  };
  const cacheable = status === 200 && !input.authorization;
  return {
    status,
    headers: cacheable
      ? { "cache-control": "public, max-age=0, s-maxage=30", vary: "authorization" }
      : { "cache-control": "private, no-store" },
    body,
  };
}

/** The answer when the database could not be asked at all. Unchanged since the first version. */
export function healthUnreachable(): HealthResponse {
  return {
    status: 503,
    headers: { "cache-control": "private, no-store" },
    body: { ok: false, error: "database_unreachable" },
  };
}
