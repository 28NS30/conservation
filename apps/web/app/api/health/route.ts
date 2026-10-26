import { asPublic, sql } from "@/lib/db";
import { schemaStatus } from "@/lib/schemaStatus";
import { secondsSinceGoodRun } from "@/lib/jobRuns";
import {
  CLASSIFICATION_QUEUE,
  QUEUE_MAX_ATTEMPTS,
  QUEUE_STALE_AFTER,
  activeJobs,
  commitOf,
  healthResponse,
  healthUnreachable,
  memoFor,
} from "@/lib/monitoring";
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

/**
 * The costly parts, kept by this instance for 30 seconds, as long as the CDN
 * keeps the public answer: the schema checks are some thirty queries, Storage
 * is a call to another service, and the bucket's size is a sum over every
 * photo. A migration applied, a Storage outage or a burst of uploads
 * therefore shows here up to 30 seconds late.
 */
const HELD_MS = 30_000;
const heldSchemaStatus = memoFor(HELD_MS, () => schemaStatus());
const heldStorageAnswers = memoFor(HELD_MS, () => storageAnswers());
const heldPhotoBytes = memoFor(HELD_MS, () => photoBucketBytes());

export async function GET(req: Request) {
  const started = Date.now();
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");
  const operator = Boolean(secret) && authorization === `Bearer ${secret}`;
  try {
    // The counts and the schema. `dbLatencyMs` times the counts alone: it
    // timed both before the schema checks were held (heldSchemaStatus), and
    // timing a held answer too would make the number depend on whether this
    // request happened to be the one that ran them. Nor may the Storage call
    // below count towards it.
    const counted = asPublic(
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
    ).then((counts) => ({ counts, latencyMs: Date.now() - started }));

    const [{ counts, latencyMs }, schema, jobSeconds, queue, dbSizeMb, storageOk, photoBytes] = await Promise.all([
      counted,
      // Runs on the app's own connection: `web_anon` has no privileges on
      // `reports`, and information_schema shows you only what you may touch — so
      // asking as the public role would report every column missing.
      heldSchemaStatus(),
      // These four may each fail on their own (job_runs is 0036's) and are
      // then reported as null or false, never as an unreachable database.
      secondsSinceGoodRun(),
      classificationQueue(),
      databaseSizeMb(),
      heldStorageAnswers(),
      heldPhotoBytes(),
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
      photoBytes,
      dbSizeMb,
      latencyMs,
      commit: commitOf(process.env.VERCEL_GIT_COMMIT_SHA),
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
 * has waited: lib/monitoring.ts CLASSIFICATION_QUEUE, the worker's own
 * predicate.
 */
async function classificationQueue() {
  try {
    const [row] = await sql.unsafe<{ waiting: number; oldest_seconds: number | null }[]>(CLASSIFICATION_QUEUE, [
      QUEUE_MAX_ATTEMPTS,
      QUEUE_STALE_AFTER,
    ]);
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
 * The photo bucket's size in bytes: what an address filling it with uploads
 * that no report uses would show first (SIGN_LIMITS, lib/abuse.ts). Read from
 * storage.objects on the app's own connection, which can see it on Supabase,
 * because the Storage API has no total and listing every object to add them
 * up would be the costliest call here. Null where there is no storage schema
 * (CI's database) or it cannot be read.
 */
async function photoBucketBytes(): Promise<number | null> {
  try {
    const [{ present }] = await sql<{ present: boolean }[]>`
      select to_regclass('storage.objects') is not null as present`;
    if (!present) return null;
    const [row] = await sql<{ bytes: number }[]>`
      select coalesce(sum((metadata->>'size')::bigint), 0)::bigint as bytes
        from storage.objects
       where bucket_id = ${PHOTO_BUCKET}`;
    return row.bytes;
  } catch (e) {
    console.error("[health] photo bytes:", (e as Error).message);
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
