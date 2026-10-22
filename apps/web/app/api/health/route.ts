import { asPublic, sql } from "@/lib/db";
import { schemaStatus } from "@/lib/schemaStatus";
import { secondsSinceGoodRun } from "@/lib/jobRuns";
import { activeJobs, healthResponse, healthUnreachable } from "@/lib/monitoring";
import { serviceSupabase, PHOTO_BUCKET } from "@/lib/supabase/service";

/**
 * Liveness + dependency check.
 *
 * Deliberately queries through `asPublic()`: that exercises the `web_anon` role
 * and the `reports_public` view, so it fails if the privacy grants are broken —
 * not just if Postgres is down.
 *
 * Read every hour by .github/workflows/production-watch.yml, after every
 * production deploy by scripts/verify-deploy.mjs, by CI before its tests, and
 * by the parent site for its counts. What each field means, and why it is
 * cached and when it is not, is in lib/monitoring.ts healthResponse().
 */

/** Never prerendered: a health check answered from the build is a health check of the build. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const started = Date.now();
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");
  const operator = Boolean(secret) && authorization === `Bearer ${secret}`;
  try {
    // The database's own answer, timed on its own: `dbLatencyMs` has always
    // meant these two, and the Storage call below must not count towards it.
    const database = Promise.all([
      asPublic(
        async (tx) =>
          (
            await tx<{ reports: number; taxa: number; species: number }[]>`
              select (select count(*) from reports_public)::int as reports,
                     (select count(*) from taxa)::int          as taxa,
                     -- Species we hold records FOR, which is not the size of the
                     -- checklist: 458 against 125,438. The parent site advertises this
                     -- one, and had it hardcoded because the taxa count is the checklist.
                     (select count(distinct taxon_id) from reports_public
                       where taxon_id is not null)::int        as species`
          )[0],
      ),
      // Runs on the app's own connection: `web_anon` has no privileges on
      // `reports`, and information_schema shows you only what you may touch — so
      // asking as the public role would report every column missing.
      schemaStatus(),
    ]).then(([counts, schema]) => ({ counts, schema, latencyMs: Date.now() - started }));

    const [{ counts, schema, latencyMs }, jobSeconds, queue, dbSizeMb, storageOk] = await Promise.all([
      database,
      // These four may each fail on their own (job_runs is 0036's) and are
      // then reported as null or false, never as an unreachable database.
      secondsSinceGoodRun(),
      classificationQueue(),
      databaseSizeMb(),
      storageAnswers(),
    ]);

    if (schema.missing.length) console.error("[health] schema missing:", schema.missing.join("; "));
    // False schemaCurrent means the database is not the one this code was
    // written against. That USED to mean exactly one thing — the code writes a
    // column that is not there, so every submission 500s — and the list has
    // since grown to cover privacy rules too: 0011 blurs an unidentified
    // record, 0012 re-blurs one whose taxon has been reclassified. A
    // deployment can be missing those and still take reports perfectly well.
    // It is still not the database this code expects.
    //
    // `npm run db:migrate` against that database says what to do — including
    // for one built by the psql loop in the launch checklist, which has no
    // migration history. `schemaMissing` names which, and only to whoever
    // holds the cron secret: named publicly, a missing rule told any visitor
    // which privacy protection was down at the moment the site was most
    // exposed (security audit, 29 September 2026). The server log always has
    // them.
    const res = healthResponse({
      counts,
      schema,
      operator,
      authorization: authorization !== null,
      jobs: activeJobs(),
      jobSeconds,
      queue,
      storageOk,
      dbSizeMb,
      latencyMs,
    });
    return Response.json(res.body, { status: res.status, headers: res.headers });
  } catch (err) {
    console.error("[health]", err);
    const res = healthUnreachable();
    return Response.json(res.body, { status: res.status, headers: res.headers });
  }
}

/**
 * Classification jobs the worker would still claim, and how long the oldest
 * has waited. 5 is lib/report/classifyWorker.ts MAX_ATTEMPTS, after which a
 * job has been given up on and is waiting for nothing; test/monitoring.test.mjs
 * holds the two equal.
 */
async function classificationQueue() {
  try {
    const [row] = await sql<{ waiting: number; oldest_seconds: number | null }[]>`
      select count(*)::int as waiting,
             extract(epoch from now() - min(created_at))::float8 as oldest_seconds
        from classification_jobs
       where status in ('queued', 'failed') and attempts < 5`;
    return { waiting: row.waiting, oldestSeconds: row.oldest_seconds };
  } catch (e) {
    console.error("[health] queue:", (e as Error).message);
    return null;
  }
}

/** The database's size on disk, in MB: the free plan stops at 500. */
async function databaseSizeMb() {
  try {
    const [row] = await sql<{ mb: number }[]>`
      select round(pg_database_size(current_database()) / 1048576.0)::int as mb`;
    return row.mb;
  } catch (e) {
    console.error("[health] size:", (e as Error).message);
    return null;
  }
}

/**
 * Whether Storage answers for the photo bucket, within three seconds. Every
 * report with a photo needs it, and nothing else here would notice it gone.
 * Asks for the bucket, not for any object in it.
 */
async function storageAnswers(): Promise<boolean> {
  try {
    const ask = serviceSupabase()
      .storage.getBucket(PHOTO_BUCKET)
      .then(({ error }) => !error);
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000).unref?.());
    return await Promise.race([ask, timeout]);
  } catch {
    return false;
  }
}
