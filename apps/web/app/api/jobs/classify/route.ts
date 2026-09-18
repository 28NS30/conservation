import { sql } from "@/lib/db";
import { downloadPhoto } from "@/lib/supabase/service";
import { UNIDENTIFIED_PRECISION } from "@conservation/shared";

/**
 * Classification worker, driven by Vercel Cron (see vercel.json).
 *
 *   POST /api/jobs/classify     Authorization: Bearer $CRON_SECRET
 *
 * Claims jobs with `for update skip locked` so concurrent invocations never
 * process the same report twice.
 */

const MAX_ATTEMPTS = 5;
const BATCH = 3;

/**
 * How long a claimed job may sit in `running` before another run may take it.
 *
 * Without this, an interrupted run loses its batch permanently: the claim marks
 * jobs `running`, and the claim query only ever looks for `queued` or `failed`,
 * so anything already claimed is invisible to every future run. The reports stay
 * `pending` and never reach the map, with nothing logging an error.
 *
 * It is not hypothetical. A Vercel Hobby function is killed at 60s, and a cold
 * Modal container alone costs ~26s of that. A deploy mid-run does the same thing.
 * Longer than any plausible run, short enough that a stuck job recovers quickly.
 */
const STALE_AFTER = "5 minutes";
/** Only auto-assign a species when the model is confident; see apps/ml/evaluate.py. */
const AUTO_ASSIGN_BANDS = new Set(["high"]);

/**
 * Vercel kills the function at this many seconds — 60 is the Hobby ceiling. The
 * batch is sized so a cold Modal start plus its jobs fits comfortably inside it,
 * and STALE_AFTER recovers the batch if it does not.
 */
export const maxDuration = 60;

/**
 * Stop starting new jobs after this many milliseconds and return normally.
 *
 * Being killed at 60s is not a neutral failure. Vercel answers a timed-out
 * function with an HTML error page, and cron-job.org aborts anything that large
 * with "output too large" — so the run looks like a broken endpoint rather than
 * a slow one, and the actual cause is invisible. A cold Modal container alone
 * costs ~26s, so three jobs can exceed the ceiling on a cold start.
 *
 * 45s leaves room for the job in flight to finish and for the response to be
 * written. Anything not started is handed straight back to the queue below, so
 * the next run picks it up immediately rather than waiting out STALE_AFTER.
 */
const TIME_BUDGET_MS = 45_000;

type Job = {
  job_id: string;
  report_id: string;
  category: string;
  /** Null until someone identifies it; 'user'/'expert' mean a person did. */
  taxon_source: string | null;
  taxon_id: number | null;
  attempts: number;
  storage_path: string | null;
};

type MlPrediction = { taxon_id: number; score: number; rank: number };
type MlResult = {
  predictions: MlPrediction[];
  detectorHit: boolean;
  band: "high" | "medium" | "low";
  modelVersion: string;
};

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // open locally, closed in prod
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Send the photo bytes rather than a URL.
 *
 * The endpoint accepts either, but a URL requires the photo to be publicly
 * fetchable *from Modal*, which couples inference to storage reachability and
 * fails outright against a local Supabase (Modal's 127.0.0.1 is its own
 * loopback, not the developer's machine). Photos are ~250 KB after the
 * client-side downscale, so inlining them is cheap — and it means a report photo
 * never needs a publicly reachable URL at all.
 */
async function callModel(
  imageBase64: string,
  category: string,
): Promise<MlResult> {
  const url = process.env.ML_ENDPOINT_URL;
  const token = process.env.ML_ENDPOINT_TOKEN;
  if (!url || !token)
    throw new Error("ML_ENDPOINT_URL / ML_ENDPOINT_TOKEN not configured");

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, imageBase64, category }),
    signal: AbortSignal.timeout(120_000), // generous: covers a Modal cold start
  });
  if (!res.ok)
    throw new Error(
      `model endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return (await res.json()) as MlResult;
}

export async function POST(req: Request) {
  if (!authorised(req))
    return Response.json({ error: "unauthorized" }, { status: 401 });

  // Claim a batch. `skip locked` lets overlapping cron runs make progress instead
  // of blocking on each other.
  const jobs = await sql<Job[]>`
    with claimed as (
      select j.id
        from classification_jobs j
       where (
               j.status in ('queued','failed')
               -- Re-claim a lease abandoned by an interrupted run. attempts is
               -- still incremented below, so a job that repeatedly kills the
               -- worker gives up rather than looping forever. (No backticks in
               -- here: this is inside a JS template literal and one would
               -- silently truncate the query.)
               or (j.status = 'running'
                   and j.updated_at < now() - ${STALE_AFTER}::interval)
             )
         and j.attempts < ${MAX_ATTEMPTS}
       order by j.created_at
       limit ${BATCH}
       for update skip locked
    )
    update classification_jobs j
       set status = 'running', attempts = j.attempts + 1, updated_at = now()
      from claimed c
     where j.id = c.id
    returning j.id::text as job_id, j.report_id::text as report_id, j.attempts,
              (select r.category from reports r where r.id = j.report_id) as category,
              (select r.taxon_source from reports r where r.id = j.report_id) as taxon_source,
              (select r.taxon_id from reports r where r.id = j.report_id) as taxon_id,
              (select p.storage_path from report_photos p
                where p.report_id = j.report_id order by p.created_at limit 1) as storage_path`;

  if (jobs.length === 0) return Response.json({ claimed: 0, processed: 0 });

  let succeeded = 0;
  let failed = 0;
  const startedAt = Date.now();
  const deferred: string[] = [];

  for (const job of jobs) {
    // Check before starting, not after: a job begun at 44s still has to finish.
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      deferred.push(job.job_id);
      continue;
    }
    try {
      if (!job.storage_path) throw new Error("report has no photo");

      const bytes = await downloadPhoto(job.storage_path);
      if (!bytes) throw new Error("could not read photo from storage");

      const result = await callModel(bytes.toString("base64"), job.category);
      const best = result.predictions[0];

      // A person already said what this is — the reporter at submission, or a
      // moderator. The model gets to record its opinion beside theirs and
      // nothing more: it looked at a photograph, they looked at the animal.
      //
      // Without this the reporter's identification survived until the next cron
      // run and was then silently replaced, taking the published precision with
      // it, because clearing the override hands control back to whichever taxon
      // the model preferred.
      const humanIdentified =
        job.taxon_id !== null && job.taxon_source !== null && job.taxon_source !== "ai";
      const assign = Boolean(best) && AUTO_ASSIGN_BANDS.has(result.band) && !humanIdentified;

      await sql.begin(async (tx) => {
        await tx`delete from classifications where report_id = ${job.report_id}::uuid`;
        for (const p of result.predictions) {
          await tx`
            insert into classifications (report_id, taxon_id, score, rank, model_version)
            values (${job.report_id}::uuid, ${p.taxon_id}, ${p.score}, ${p.rank}, ${result.modelVersion})`;
        }

        if (assign) {
          // Clearing the override hands control back to the taxon's own policy —
          // which will re-blur immediately if the identified species is sensitive,
          // because the trigger fires on `taxon_id`.
          await tx`
            update reports
               set taxon_id = ${best.taxon_id},
                   taxon_source = 'ai',
                   ai_confidence = ${best.score},
                   ai_band = ${result.band},
                   precision_override = null,
                   status = 'published'
             where id = ${job.report_id}::uuid`;
        } else if (humanIdentified) {
          // Keep their identification and the precision it implies; record what
          // the model thought, and say so if the two disagree. Nothing here
          // changes what is published — a disagreement is a note for a reviewer,
          // not grounds for overriding the person who was there.
          const disagrees =
            Boolean(best) &&
            AUTO_ASSIGN_BANDS.has(result.band) &&
            best.taxon_id !== job.taxon_id;
          await tx`
            update reports
               set ai_confidence = ${best?.score ?? null},
                   ai_band = ${result.band},
                   flagged_reason = ${
                     disagrees
                       ? "the model and the reporter name different species"
                       : null
                   }
             where id = ${job.report_id}::uuid`;
        } else {
          // Not confident enough to name a species. Publish it as an unidentified
          // record, but keep the conservative precision: an unknown animal might
          // be a protected one.
          //
          // `ai_band` is what decides whether the reporter is offered the top-5 to
          // confirm. In the medium band that list is worth showing — measured top-5
          // is 91.6%. In the low band it is 68%, and report_ai_suggestions withholds
          // it, because a confidently-presented wrong species anchors the reporter
          // and a bad identification is worse for the dataset than none.
          await tx`
            update reports
               set precision_override = ${UNIDENTIFIED_PRECISION},
                   status = 'published',
                   ai_band = ${result.band},
                   flagged_reason = ${
                     result.band === "low"
                       ? "model could not identify this with any confidence"
                       : "low confidence identification"
                   }
             where id = ${job.report_id}::uuid`;
        }

        await tx`update classification_jobs set status = 'done', last_error = null, updated_at = now()
                  where id = ${job.job_id}::bigint`;
      });

      succeeded++;
    } catch (err) {
      failed++;
      const message = (err as Error).message.slice(0, 500);
      const giveUp = job.attempts >= MAX_ATTEMPTS;

      await sql.begin(async (tx) => {
        await tx`
          update classification_jobs
             set status = ${giveUp ? "failed" : "queued"}, last_error = ${message}, updated_at = now()
           where id = ${job.job_id}::bigint`;

        if (giveUp) {
          // Never lose a report because the model was unavailable: blur it,
          // flag it for a human, and leave it held.
          //
          // `and status = 'pending'` is load-bearing, not defensive. A report
          // the reporter identified themselves is inserted `published` and is
          // STILL queued for classification (the model's opinion is worth
          // recording beside theirs), so without the guard a model outage would
          // pull a record off the public map hours after it appeared — and,
          // worse, would falsify the invariant lib/receipt.ts relies on to
          // decide whose id it may confirm. A row that is pending must have
          // been pending since it was written.
          await tx`
            update reports
               set precision_override = ${UNIDENTIFIED_PRECISION},
                   flagged_reason = 'classification unavailable'
             where id = ${job.report_id}::uuid
               and status = 'pending'`;
        }
      });

      console.error(`[jobs/classify] ${job.report_id}: ${message}`);
    }
  }

  // Hand back what we never started, so it is picked up on the next run instead
  // of sitting `running` until the stale-lease sweep notices in five minutes.
  if (deferred.length > 0) {
    await sql`
      update classification_jobs
         set status = 'queued', attempts = attempts - 1
       where id = any(${deferred}::bigint[])`;
  }

  // Deliberately small. This is read by a cron service, not a human, and a large
  // body is what made a timeout look like a broken endpoint.
  return Response.json({
    claimed: jobs.length,
    processed: succeeded,
    failed,
    deferred: deferred.length,
  });
}
