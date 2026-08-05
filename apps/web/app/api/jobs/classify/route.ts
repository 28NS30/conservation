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
const BATCH = 5;
/** Only auto-assign a species when the model is confident; see apps/ml/evaluate.py. */
const AUTO_ASSIGN_BANDS = new Set(["high"]);

type Job = {
  job_id: string;
  report_id: string;
  category: string;
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
async function callModel(imageBase64: string, category: string): Promise<MlResult> {
  const url = process.env.ML_ENDPOINT_URL;
  const token = process.env.ML_ENDPOINT_TOKEN;
  if (!url || !token) throw new Error("ML_ENDPOINT_URL / ML_ENDPOINT_TOKEN not configured");

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, imageBase64, category }),
    signal: AbortSignal.timeout(120_000), // generous: covers a Modal cold start
  });
  if (!res.ok) throw new Error(`model endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as MlResult;
}

export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Claim a batch. `skip locked` lets overlapping cron runs make progress instead
  // of blocking on each other.
  const jobs = await sql<Job[]>`
    with claimed as (
      select j.id
        from classification_jobs j
       where j.status in ('queued','failed')
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
              (select p.storage_path from report_photos p
                where p.report_id = j.report_id order by p.created_at limit 1) as storage_path`;

  if (jobs.length === 0) return Response.json({ claimed: 0, processed: 0 });

  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      if (!job.storage_path) throw new Error("report has no photo");

      const bytes = await downloadPhoto(job.storage_path);
      if (!bytes) throw new Error("could not read photo from storage");

      const result = await callModel(bytes.toString("base64"), job.category);
      const best = result.predictions[0];
      const assign = best && AUTO_ASSIGN_BANDS.has(result.band);

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
          // Never lose a report because the model was unavailable. Publish it
          // unidentified and blurred, and flag it for a human.
          await tx`
            update reports
               set precision_override = ${UNIDENTIFIED_PRECISION},
                   status = 'pending',
                   flagged_reason = 'classification unavailable'
             where id = ${job.report_id}::uuid`;
        }
      });

      console.error(`[jobs/classify] ${job.report_id}: ${message}`);
    }
  }

  return Response.json({ claimed: jobs.length, processed: succeeded, failed });
}
