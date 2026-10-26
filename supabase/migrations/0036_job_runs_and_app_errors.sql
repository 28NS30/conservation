-- What the site's scheduled jobs did, and which pages failed, kept where
-- someone can look.
--
-- Vercel's Hobby plan keeps function logs for about an hour, and nothing else
-- recorded either fact. A nightly job that fails, or is killed at its time
-- limit, every night left nothing behind; a page that 500s for one kind of
-- record leaves a log line that is gone by morning. Both looked exactly like
-- "nothing happened".
--
-- A run refused at the door still writes nothing: a job that answers 401
-- because CRON_SECRET is unset never reaches its first write, and that is on
-- purpose, since otherwise anyone could add rows. What shows it is the
-- absence of good runs: /api/health reports no good run for the job, and the
-- hourly watch (scripts/production-watch.mjs) opens a `jobs-stale` issue
-- once that has lasted two days.
--
-- JOB_RUNS. Each job route (apps/web/app/api/jobs/*) writes a row when it
-- starts and fills in `finished_at`, `ok` and `detail` when it ends
-- (apps/web/lib/jobRuns.ts). A run that never finishes, because the function
-- was killed, keeps its row with `finished_at` null, which is itself the
-- record. /api/health reports the hours since each job's last good run.
-- `detail` is the job's own short summary, counts only: the routes answer
-- with counts by design, and a failure records the error's class and code,
-- never its message, which can quote a value from a row.
--
-- APP_ERRORS. Next.js calls instrumentation.ts onRequestError for a server
-- error in any page, route or action; it adds one to the row for that route
-- pattern, error digest and hour (apps/web/lib/appErrors.ts). The route is the
-- PATTERN, such as /[locale]/(site)/reports/[id], never the address that was
-- asked for, which can carry a record id or a search term; the digest is the
-- hash Next.js already shows on the error page. No body, no header, no
-- address, no user: nothing in either table says who did anything. The writer
-- stops adding new rows at 200 for an hour, so a burst of distinct errors
-- cannot fill the table, and the cleanup job deletes rows after 30 days
-- (app_errors) and 90 days (job_runs).
--
-- Neither table is public. Row-level security on, no policy, nothing granted
-- to `anon`, `authenticated` or `web_anon`, exactly like the other base
-- tables; only the server's own connection reads or writes them. /api/health
-- exposes aggregates of job_runs, and nothing of app_errors.
--
-- Additive and safe to re-run: two new tables, their indexes and their
-- grants. No existing row or rule changes, and no blur is touched.

-- Give up rather than queue: see 0014. Nothing here locks an existing table
-- except the catalogue entries of the two it creates.
set local lock_timeout = '5s';

create table if not exists job_runs (
  id          bigserial primary key,
  -- The job's name as apps/web/lib/monitoring.ts JOBS spells it.
  job         text not null check (job ~ '^[a-z][a-z0-9-]{0,39}$'),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  detail      text check (char_length(detail) <= 300),
  -- A run is either still going (both null) or over (both set).
  constraint job_runs_finished_has_outcome check ((finished_at is null) = (ok is null))
);

-- "When did this job last succeed", which /api/health asks for every job.
create index if not exists job_runs_last_ok on job_runs (job, finished_at desc) where ok;
-- The cleanup job's purge.
create index if not exists job_runs_started_at on job_runs (started_at);

create table if not exists app_errors (
  -- The route pattern, as Next.js names it in onRequestError's context.
  route  text not null check (char_length(route) between 1 and 200),
  -- '' when Next.js gave the error no digest (route handlers do not).
  digest text not null default '' check (char_length(digest) <= 64),
  -- The hour the errors fell in, truncated in UTC.
  hour   timestamptz not null,
  count  int not null default 1 check (count > 0),
  primary key (hour, route, digest)
);

-- ---------------------------------------------------------------------------
-- Grants and row-level security
-- ---------------------------------------------------------------------------

alter table job_runs enable row level security;
alter table app_errors enable row level security;

-- 0013 closed every new table to the Supabase roles by default; this says so
-- for these two anyway, in case this file is run by a role whose defaults
-- 0013 did not cover. The Supabase roles are revoked behind a guard because a
-- plain Postgres, such as CI's, has neither of them.
revoke all on job_runs, app_errors from public, web_anon;
revoke all on sequence job_runs_id_seq from public, web_anon;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on job_runs, app_errors from %I', r);
      execute format('revoke all on sequence job_runs_id_seq from %I', r);
    end if;
  end loop;
end $$;
