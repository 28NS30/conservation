import { sql } from "@/lib/db";
import { downloadPhoto } from "@/lib/supabase/service";
import { UNIDENTIFIED_PRECISION } from "@conservation/shared";
import {
  photoIdentificationOverride,
  suggestionOverride,
} from "@/lib/report/precision";
import {
  AUTO_ASSIGN_BANDS,
  classifierAction,
  mlContract,
} from "@/lib/report/classifyPolicy";
import { callModel, callEvidenceModel, ModelRefused } from "@/lib/report/model";
import { recordEvidence } from "@/lib/report/classifyEvidence";

/**
 * The classification worker: claims queued jobs, sends each report's photo to
 * the model service, and writes what the rules allow.
 *
 * Two callers. The cron route (app/api/jobs/classify) runs it over whatever is
 * queued, as a sweeper for retries and for anything the other caller missed.
 * POST /api/reports runs it for the one report just filed, in after(), so a
 * photo is identified minutes after it is sent rather than at 03:00 the next
 * night — Vercel Hobby runs a cron at most once a day, and the daily batch of
 * three was the whole throughput. Claims use `for update skip locked`, so the
 * two can never process the same job twice.
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
  /** The scientific name of `taxon_id`, for comparing with the model at the binomial. */
  taxon_name: string | null;
  attempts: number;
  storage_path: string | null;
};

export type ClassifyRun = { claimed: number; processed: number; failed: number; deferred: number };

export async function classifyQueued({ reportId = null }: { reportId?: string | null } = {}): Promise<ClassifyRun> {
  // A job killed during its LAST attempt (the function's time limit, a deploy,
  // a model that hangs) is left 'running' with attempts at the maximum, which
  // the claim below will never take again, so its give-up branch never ran:
  // the report sat pending with no reason given (security audit, 29 September
  // 2026). Retire such jobs here exactly as that branch would.
  await sql`
    with stuck as (
      update classification_jobs
         set status = 'failed',
             last_error = coalesce(last_error, 'abandoned during its last attempt'),
             updated_at = now()
       where status = 'running'
         and attempts >= ${MAX_ATTEMPTS}
         and updated_at < now() - ${STALE_AFTER}::interval
      returning report_id)
    update reports r
       set precision_override = stricter_precision(r.precision_override,
                                                   ${UNIDENTIFIED_PRECISION}::text),
           flagged_reason = coalesce(r.flagged_reason, 'classification unavailable')
      from stuck
     where r.id = stuck.report_id
       and r.status = 'pending'`;

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
         -- Not a report a moderator has thrown out. Rejecting a report does
         -- not cancel its classification job, and this query filtered on the
         -- JOB's status alone — so the worker would claim the job, run the
         -- model, and write status = 'published' over the rejection. Spam a
         -- moderator had removed went back on the public map on the next cron
         -- run, with nothing anywhere saying it had.
         --
         -- 'published' is deliberately still claimable: a job is queued even
         -- when the reporter named the species, because the model's opinion is
         -- worth recording beside theirs, and that branch writes no status.
         and exists (select 1 from reports r
                      where r.id = j.report_id and r.status <> 'rejected')
         -- One report's job only, when called right after that report was
         -- filed (POST /api/reports); every claimable job for the cron.
         and (${reportId}::uuid is null or j.report_id = ${reportId}::uuid)
       order by j.created_at
       limit ${reportId ? 1 : BATCH}
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
              (select t.scientific_name from reports r join taxa t on t.id = r.taxon_id
                where r.id = j.report_id) as taxon_name,
              (select p.storage_path from report_photos p
                where p.report_id = j.report_id order by p.created_at limit 1) as storage_path`;

  if (jobs.length === 0) return { claimed: 0, processed: 0, failed: 0, deferred: 0 };

  let succeeded = 0;
  let failed = 0;
  const startedAt = Date.now();
  const contract = mlContract(process.env);
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

      if (contract === 2) {
        // The model returns evidence and the website decides: the rules for
        // each kind of report are in lib/report/classifyPolicy.ts, the writes
        // (the same columns, through the same precision helpers as below) in
        // lib/report/classifyEvidence.ts. Failure takes the catch below, as a
        // legacy failure does.
        await recordEvidence(job, await callEvidenceModel(bytes.toString("base64")));
        succeeded++;
        continue;
      }

      // The page's own category chooses the label list (apps/ml/labelsets.py).
      // Not remapped here: an injured animal is scored against the whole
      // checklist, because a list without the stranded sea turtle cannot name
      // it and would name something else (lib/report/classifyPolicy.ts).
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
      // Whether the model may name the species is decided by the page the
      // report was filed on as well as by the band: an invasive report's answer
      // comes from a closed list and is only ever a suggestion. See
      // lib/report/classifyPolicy.ts for what that list did to native animals.
      const action = classifierAction({
        category: job.category,
        band: result.band,
        hasPrediction: Boolean(best),
        humanIdentified,
      });

      await sql.begin(async (tx) => {
        await tx`delete from classifications where report_id = ${job.report_id}::uuid`;
        for (const p of result.predictions) {
          await tx`
            insert into classifications (report_id, taxon_id, score, rank, model_version)
            values (${job.report_id}::uuid, ${p.taxon_id}, ${p.score}, ${p.rank}, ${result.modelVersion})`;
        }

        if (action === "assign") {
          // Clearing the override hands control back to the taxon's own policy —
          // which will re-blur immediately if the identified species is sensitive,
          // because the trigger fires on `taxon_id`.
          //
          // `keepDeliberateOverride` rather than a bare `null`, on the same rule
          // as the two confirm paths. In practice this branch only runs on a
          // report nobody has named, so the two are the same answer today; it is
          // written this way so that the rule lives in one place and cannot drift
          // back apart, which is how the three of them disagreed to begin with.
          //
          // `photoIdentificationOverride` is that rule plus one more: the blur is
          // at least the strictest of every row sharing the named taxon's
          // binomial, because a photograph cannot say which of them it is.
          await tx`
            update reports
               set taxon_id = ${best.taxon_id},
                   taxon_source = 'ai',
                   ai_confidence = ${best.score},
                   ai_band = ${result.band},
                   precision_override = ${photoIdentificationOverride(best.taxon_id)},
                   -- Claim and process are two transactions, so a moderator can
                   -- reject a report in between. Publishing may lift a hold; it
                   -- may not reverse a decision.
                   status = case when status = 'pending' and flagged_reason is null then 'published' else status end
             where id = ${job.report_id}::uuid
               -- Only if nobody named the species while the model ran: claim
               -- and write are two transactions, and a person's identification
               -- made in between is theirs, not the model's to overwrite.
               and taxon_id is not distinct from ${job.taxon_id}::bigint
               and taxon_source is not distinct from ${job.taxon_source}::text`;
        } else if (action === "record") {
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
                   flagged_reason = coalesce(flagged_reason, ${
                     disagrees
                       ? "the model and the reporter name different species"
                       : null
                   })
             where id = ${job.report_id}::uuid`;
        } else {
          // Not a species the model may name: either it is not confident enough,
          // or this is a report whose answer can only ever be a suggestion (an
          // invasive report, scored against a closed list). Publish it as an
          // unidentified record, but keep the conservative precision: an unknown
          // animal might be a protected one.
          //
          // `ai_band` is what decides whether the reporter is offered the top-5 to
          // confirm. In the medium band that list is worth showing — measured top-5
          // is 91.6%. In the low band it is 68%, and report_ai_suggestions withholds
          // it, because a confidently-presented wrong species anchors the reporter
          // and a bad identification is worse for the dataset than none.
          //
          // Where the list is shown, the record is blurred at least as hard as the
          // strictest species on it; see suggestionOverride. The rows it reads are
          // the ones inserted above, in this transaction.
          await tx`
            update reports
               set precision_override = ${suggestionOverride(
                 job.report_id,
                 result.band !== "low",
               )},
                   status = case when status = 'pending' and flagged_reason is null then 'published' else status end,
                   ai_band = ${result.band},
                   flagged_reason = coalesce(flagged_reason, ${
                     result.band === "low"
                       ? "model could not identify this with any confidence"
                       : AUTO_ASSIGN_BANDS.has(result.band)
                         ? "the model only suggests a species for this kind of report"
                         : "low confidence identification"
                   })
             where id = ${job.report_id}::uuid
               -- Only if nobody named the species while the model ran: claim
               -- and write are two transactions, and a person's identification
               -- made in between is theirs, not the model's to overwrite.
               and taxon_id is not distinct from ${job.taxon_id}::bigint
               and taxon_source is not distinct from ${job.taxon_source}::text`;
        }

        await tx`update classification_jobs set status = 'done', last_error = null, updated_at = now()
                  where id = ${job.job_id}::bigint`;
      });

      succeeded++;
    } catch (err) {
      failed++;
      const message = (err as Error).message.slice(0, 500);
      const giveUp = job.attempts >= MAX_ATTEMPTS || err instanceof ModelRefused;

      await sql.begin(async (tx) => {
        // A refused photograph is retired for good: attempts goes to the
        // maximum, because the claim above takes 'failed' jobs back while
        // attempts are left, and a 'failed' written with attempts to spare
        // was sent to the GPU again on every run until they ran out (review of
        // the security fixes, 30 September 2026).
        await tx`
          update classification_jobs
             set status = ${giveUp ? "failed" : "queued"}, last_error = ${message}, updated_at = now(),
                 attempts = ${err instanceof ModelRefused ? sql`greatest(attempts, ${MAX_ATTEMPTS})` : sql`attempts`}
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
          //
          // At least the unidentified blur, never less than the record already
          // has: see suggestionOverride for who else may have held it coarser.
          await tx`
            update reports
               set precision_override = stricter_precision(precision_override,
                                                           ${UNIDENTIFIED_PRECISION}::text),
                   flagged_reason = coalesce(flagged_reason, 'classification unavailable')
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
  return {
    claimed: jobs.length,
    processed: succeeded,
    failed,
    deferred: deferred.length,
  };
}
