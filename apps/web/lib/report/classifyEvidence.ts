import "server-only";
import { sql } from "@/lib/db";
import {
  photoIdentificationOverride,
  suggestionOverride,
} from "@/lib/report/precision";
import {
  BLUR_OF_SHOWN_SQL,
  RESOLVE_CANDIDATES_SQL,
  decideFromEvidence,
  disagreesWithPerson,
  guardCongeners,
  toCandidates,
  type EvidenceDecision,
  type EvidenceResponse,
  type ResolvedRow,
} from "@/lib/report/classifyPolicy";

/**
 * The worker's writes for one report under the evidence contract
 * (ML_CONTRACT=2). The rules are in classifyPolicy.ts and pure; this is only
 * where their answer meets the database.
 *
 * Every write here is one the legacy branch in app/api/jobs/classify/route.ts
 * already makes, to the same columns, through the same precision helpers:
 *
 *   assign   the species becomes the record's, and its blur is at least the
 *            strictest of every row sharing its binomial
 *            (photoIdentificationOverride), exactly as before;
 *   record   a person named it; the model's view is noted beside theirs;
 *   suggest  the record stays unidentified, blurred at least as hard as the
 *            strictest species it is shown with (suggestionOverride).
 *
 * The suggestions kept are the profile's top five, not the model's fifty.
 * `report_ai_suggestions` publishes every `classifications` row of a report,
 * and suggestionOverride blurs by the strictest of them: fifty rows would put
 * forty-five species nobody is shown on the record's public page and blur it
 * for all of them.
 */

export type EvidenceJob = {
  job_id: string;
  report_id: string;
  category: string;
  taxon_source: string | null;
  taxon_id: number | null;
  /** The scientific name of the taxon a person gave, if one did. */
  taxon_name: string | null;
};

export async function resolveCandidates(result: EvidenceResponse) {
  const ids = result.candidates.map((c) => c.taicol_id);
  const rows = await sql.unsafe<ResolvedRow[]>(RESOLVE_CANDIDATES_SQL, [ids]);
  return toCandidates(result, rows);
}

export async function recordEvidence(
  job: EvidenceJob,
  result: EvidenceResponse,
): Promise<EvidenceDecision> {
  const humanIdentified =
    job.taxon_id !== null && job.taxon_source !== null && job.taxon_source !== "ai";
  let decision = decideFromEvidence({
    category: job.category,
    candidates: await resolveCandidates(result),
    humanIdentified,
    modelVersion: result.modelVersion,
  });
  if (decision.action === "assign") {
    // Only now, and only for the five shown: see guardCongeners.
    const blurs = await sql.unsafe<{ taicol_id: string; blur: string | null }[]>(
      BLUR_OF_SHOWN_SQL,
      [decision.shown.map((c) => c.taicolId)],
    );
    decision = guardCongeners(decision, new Map(blurs.map((r) => [r.taicol_id, r.blur])));
  }
  const { best, band } = decision;

  await sql.begin(async (tx) => {
    await tx`delete from classifications where report_id = ${job.report_id}::uuid`;
    for (const [i, c] of decision.shown.entries()) {
      await tx`
        insert into classifications (report_id, taxon_id, score, rank, model_version)
        values (${job.report_id}::uuid, ${c.taxonId}, ${c.score}, ${i + 1}, ${result.modelVersion})`;
    }

    if (decision.action === "assign" && best) {
      // As the legacy branch: the stamp rule (keepDeliberateOverride) plus the
      // binomial's strictest blur, because a photograph cannot tell which of
      // the rows sharing a name it shows.
      await tx`
        update reports
           set taxon_id = ${best.taxonId},
               taxon_source = 'ai',
               ai_confidence = ${best.score},
               ai_band = ${band},
               precision_override = ${photoIdentificationOverride(best.taxonId)},
               -- Publishing may lift a hold; it may not reverse a decision.
               status = case when status = 'pending' and flagged_reason is null then 'published' else status end
         where id = ${job.report_id}::uuid
           -- Only if nobody named the species while the model ran (see
           -- classifyWorker.ts).
           and taxon_id is not distinct from ${job.taxon_id}::bigint
           and taxon_source is not distinct from ${job.taxon_source}::text`;
    } else if (decision.action === "record") {
      await tx`
        update reports
           set ai_confidence = ${best?.score ?? null},
               ai_band = ${band},
               flagged_reason = coalesce(flagged_reason, ${
                 disagreesWithPerson(decision, job.taxon_name)
                   ? "the model and the reporter name different species"
                   : null
               })
         where id = ${job.report_id}::uuid`;
    } else {
      // Unidentified, and blurred at least as hard as the strictest species it
      // is shown with. On an invasive report this is every answer: the model
      // suggests, a person confirms.
      await tx`
        update reports
           set precision_override = ${suggestionOverride(job.report_id, band !== "low")},
               status = case when status = 'pending' and flagged_reason is null then 'published' else status end,
               ai_band = ${band},
               flagged_reason = coalesce(flagged_reason, ${decision.reason})
         where id = ${job.report_id}::uuid
           -- Only if nobody named the species while the model ran (see
           -- classifyWorker.ts).
           and taxon_id is not distinct from ${job.taxon_id}::bigint
           and taxon_source is not distinct from ${job.taxon_source}::text`;
    }

    // In the same transaction as the writes, as the legacy branch does: a job
    // marked done without its writes would never be looked at again.
    await tx`update classification_jobs set status = 'done', last_error = null, updated_at = now()
              where id = ${job.job_id}::bigint`;
  });

  return decision;
}
