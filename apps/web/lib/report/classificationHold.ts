import type postgres from "postgres";
import { UNIDENTIFIED_PRECISION } from "@conservation/shared";

/**
 * What the classifier does to the blur of a record a person named.
 *
 * The model's view of such a record used to be noted beside the person's and
 * nothing more, on the rule that they saw the animal and the model saw a
 * photograph. That rule was a loophole: a dead 石虎 filed as 家貓 was
 * published at the cat's blur, to the metre, and the only trace was a flag on
 * a published record that no page showed. Two things close it.
 *
 * THE TEMPORARY HOLD. A report its reporter named, with a photo, is published
 * at once but held at least at the unidentified blur (10 km) until the model
 * has looked at the photo: POST /api/reports sets
 * `reports.held_for_classification`, and the blur trigger takes the stricter
 * of that and the record's own rule (migration 0033). Publishing it at its
 * species' rule straight away, and tightening it only when the model
 * answered, left it public to the metre for as long as the model took, and
 * for good when the model never answered: a failed run waits for the next
 * day's cron, and a job that gives up never touches a published record.
 *
 * RELEASING THE HOLD IS NOT A LOOSENING. The owner decided where a named
 * record ends (blur policy, 30 September 2026: an invasive species at its
 * exact spot, a protected one at its rating's blur, and so on), and the hold
 * is a short technical state on the way there, while the one check that could
 * contradict the reporter has not run. When the classifier has run, the
 * record goes to that decided blur: its species' rule, tightened by the
 * model's (below) when the model is sure of another species. When the model
 * never answers (it refused the photo, or the job ran out of attempts) the
 * hold stays, so failure is the safe direction.
 *
 * It is a column of its own, not a value of `precision_override`, so that it
 * cannot be mistaken for anything an override means. An override on a named
 * record is a decision that it stays coarser than its rating asks: a
 * moderator's, the GBIF remap's, the model's (below). An override of 10 km on
 * an unnamed one is the unidentified stamp, which naming the animal clears
 * (keepDeliberateOverride, precision.ts). A floor is a row in
 * `taxon_precision_floors`. Releasing the hold clears this column and nothing
 * else: no override, no floor and no rating is read as the hold or cleared
 * with it, and only the classifier, when it has run, releases it.
 *
 * THE MODEL'S BLUR. When the model, in a band it may name a species in by
 * itself, names a different species from the reporter, the record keeps the
 * reporter's species and is blurred at least as hard as the model's species
 * would be, at its binomial's strictest (as when the model names one itself,
 * photoIdentificationOverride). As an override, so that it outlives what
 * comes after: every later naming keeps an override on a record that already
 * has a taxon (keepDeliberateOverride), so a re-pick, or a moderator's
 * correction to the cat, leaves the record at least where the model's answer
 * put it. Loosening it is a person's decision, made as one, not a side effect
 * of renaming.
 *
 * Only the reporter's own naming (`taxon_source = 'user'`). A moderator's
 * (`'expert'`) is a person who has looked at the photograph on purpose, and
 * the record page gives nobody a way to undo an override the model wrote
 * over theirs.
 *
 * Plain SQL with the caller's transaction, and no server-only import, so the
 * tests run these functions themselves rather than a copy of them.
 */

/** The flag a record carries when the model, sure of itself, names another species. */
export const DISAGREES_FLAG = "the model and the reporter name different species";

export type PersonNamedAnswer = {
  reportId: string;
  /** The taxon the job was claimed with: the name the model was compared to. */
  claimedTaxonId: number | null;
  /** Who gave that name: 'user' is the reporter, 'expert' a moderator. */
  claimedSource: string | null;
  score: number | null;
  band: string;
  /**
   * The model's species when, confident, it names a different one from the
   * person at the binomial (disagreesAtBinomial, classifyPolicy.ts); null when
   * it agrees, is not confident, or has no answer.
   */
  disagreeingTaxonId: number | null;
};

/**
 * The 'record' branch of both workers: a person named the species, and the
 * model's answer is written beside theirs. The species stays theirs; the
 * blur is settled (settleClassificationHold).
 */
export async function recordBesidePerson(tx: postgres.TransactionSql, a: PersonNamedAnswer) {
  const reporters = a.claimedSource === "user";
  const disagrees = reporters && a.disagreeingTaxonId !== null;
  await tx`
    update reports
       set ai_confidence = ${a.score},
           ai_band = ${a.band},
           flagged_reason = coalesce(flagged_reason, ${disagrees ? DISAGREES_FLAG : null})
     where id = ${a.reportId}::uuid`;
  await settleClassificationHold(
    tx,
    a.reportId,
    disagrees ? a.disagreeingTaxonId : null,
    a.claimedTaxonId,
  );
}

/**
 * Release the temporary hold, and write the model's blur when it disagrees.
 * One statement, so the record goes from held to settled in one step.
 *
 * The model's blur counts only while the record is still named as it was when
 * the job was claimed, by its reporter. A moderator who renamed it while the
 * model ran made a decision about a different name, and the model's answer
 * was not compared with theirs. The hold is released either way: the
 * classifier has run.
 *
 * Never looser than the record is now, apart from the hold itself. Writing
 * `precision_override` or the hold re-runs the blur trigger, which derives the
 * blur afresh from today's rules, and a record can be blurred harder than
 * those say (tighten_reports, 0014, never loosens one whose rating was
 * withdrawn). So when the fresh blur would be looser than the one the record
 * has, that blur is kept as part of the override. What is not kept is the
 * hold's own level: a held record at exactly 10 km is there because of the
 * hold (or a rule that still says 10 km, which the fresh blur keeps), and
 * keeping that would make the hold permanent. A rule of exactly 10 km
 * withdrawn in the minutes a record is held is the one case that ends at the
 * species' current rule, where a rename would also put it.
 *
 * Writes nothing when there is no hold to release and no blur to add, so a
 * record classified before the hold existed is left as it is.
 */
export const settleClassificationHold = (
  tx: postgres.TransactionSql,
  reportId: string,
  modelTaxonId: number | null,
  claimedTaxonId: number | null,
) => tx`
  with cur as (
    select r.id,
           r.held_for_classification as held,
           r.precision_override as override,
           case when ${modelTaxonId}::bigint is not null
                 and r.taxon_source = 'user'
                 and r.taxon_id is not distinct from ${claimedTaxonId}::bigint
                 and precision_rank(binomial_precision(${modelTaxonId}::bigint))
                     > precision_rank('exact')
                then binomial_precision(${modelTaxonId}::bigint) end as model_p,
           case when r.held_for_classification
                 and precision_rank(r.location_precision)
                     <= precision_rank(${UNIDENTIFIED_PRECISION}::text)
                then 'exact'
                else r.location_precision end as kept
      from reports r
     where r.id = ${reportId}::uuid
  )
  update reports r
     set precision_override = case
           when precision_rank(report_precision(r.taxon_id,
                                                stricter_precision(cur.override, cur.model_p)))
                >= precision_rank(cur.kept)
           then stricter_precision(cur.override, cur.model_p)
           else stricter_precision(stricter_precision(cur.override, cur.model_p), cur.kept)
         end,
         held_for_classification = false
    from cur
   where r.id = cur.id
     and (cur.held or cur.model_p is not null)`;
