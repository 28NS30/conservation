import type postgres from "postgres";

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
 * day's cron, and a job that gives up never blurs a published record.
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
 * OFF THE MAP WHILE HELD. The hold is 10 km whatever the species, so a
 * 石虎 filed as 家貓 sits in a 10 km cell until the model's answer blurs it to
 * 50 km. Map tiles are cached by the CDN for up to about 25 hours, where the
 * app cannot purge them, so a held record is left out of every tile layer
 * until it is released (`reports_on_map`, migration 0033), and the cell never
 * reaches a cache that could outlive the model's answer. Nor does it reach
 * any other kept list of points: a species page, static until the next
 * deploy, lists a sparse species' records from the same view, as do the
 * lab's ledger and the /stats hotspots (lib/species.ts, lib/stats.ts), and
 * so does the Darwin Core export (scripts/dwc-occurrences.ts), whose copy on
 * GBIF outlives everything. Its own page and the /reports list, both read on
 * every request, do show it, in the hold's 10 km cell, and the counts on
 * every page include it: for minutes when the run straight after the report
 * is filed works (POST /api/reports, in after()), until the next daily cron
 * when that run fails, and for good when the model never answers.
 *
 * RELEASED WHERE IT WOULD BE IF IT HAD NEVER BEEN HELD. A record's blur only
 * tightens between renames (tighten_reports, 0014), so one whose 10 km rating
 * is withdrawn keeps its 10 km. Re-derived from the rules at the release, a
 * held record lost that: a 10 km rule it was filed under, or was given
 * during the hold, and that was withdrawn before the release, left it exact
 * beside a twin that was never held at 10 km. So the blur trigger keeps,
 * beside the hold, the blur the record would have without it,
 * `held_rule_precision` (migration 0033), tightened by every rule given
 * during the hold as an unheld record is, started again by a rename as an
 * unheld record is re-derived by one, and the release puts the record there.
 * It is null on a record that is not held, so a record's decided blur, held
 * or not, is `coalesce(held_rule_precision, location_precision)`: that is
 * what anything deciding from a record's blur reads (settleClassificationHold
 * below, confirmSpecies' re-pick), never location_precision, which on a held
 * record is the hold's 10 km and kept as an override would hold a named
 * invasive species off its exact spot for good.
 *
 * AND NOT HELD SILENTLY. A record the model never answers for would stay at
 * 10 km for good, overriding the owner's decision that a named invasive
 * species is published at its exact spot, with nothing to say so. So both of
 * the worker's give-up paths flag it (flagHeldUnclassified,
 * flagHeldAbandoned), a moderator who publishes one the abuse screen held
 * publishes it with that flag (flagWhenPublished), the moderation queue lists
 * it among the published records with a flag, and a moderator can put its
 * job back in the queue (requeueClassification). Neither the flag, nor
 * clearing it, nor the requeue releases the hold: only a finished
 * classification does. And a finished one always does, even when a person
 * renamed the record while the model ran and the model's write is not made.
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

/**
 * The flag a record carries when the model never answered for its photo: the
 * same words the give-up paths have always written on a pending report, so
 * the queue reads both the same way (lib/report/flagReasons.ts).
 */
export const UNAVAILABLE_FLAG = "classification unavailable";

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
 * Released, the record goes to its decided blur: the blur it would have had
 * if it had never been held, which the trigger keeps beside the hold
 * (`held_rule_precision`, 0033) and puts it at when the hold is cleared. The
 * release itself writes no override, so the record is left as a twin that
 * was never held would be, and a later rename re-derives it as it would the
 * twin.
 *
 * The model's blur is written as on that twin. Writing `precision_override`
 * re-runs the blur trigger, which on a record that is not held derives the
 * blur afresh from today's rules, and a record can be blurred harder than
 * those say (tighten_reports, 0014, never loosens one whose rating was
 * withdrawn). So when the fresh blur would be looser than the record's
 * decided blur, that blur is kept as part of the override; on a held record
 * the trigger would keep it anyway, and the override is the twin's.
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
           -- The decided blur: without the hold, as the trigger keeps it (0033).
           coalesce(r.held_rule_precision, r.location_precision) as kept
      from reports r
     where r.id = ${reportId}::uuid
  )
  update reports r
     set precision_override = case
           when cur.model_p is null then cur.override
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

/**
 * Flag a published record still held after the worker gave up on its job:
 * the model refused the photo, or the job ran out of attempts.
 *
 * Its own statement beside the give-up path's, which flags and blurs a
 * pending report and must never touch a published one (lib/receipt.ts relies
 * on that; test/receipt.test.mjs holds it). This one touches nothing but the
 * flag, and only on a published record that is held, so the record stays
 * public, at the hold's 10 km and off the map, and is listed in the
 * moderation queue instead of waiting there unseen. A flag already on it is
 * kept. A held report that is still pending is flagged when a moderator
 * publishes it (flagWhenPublished).
 */
export const flagHeldUnclassified = (tx: postgres.TransactionSql, reportId: string) => tx`
  update reports
     set flagged_reason = coalesce(flagged_reason, ${UNAVAILABLE_FLAG})
   where id = ${reportId}::uuid
     and status = 'published'
     and held_for_classification`;

/**
 * The flag a pending report is published with: a fragment of publishReport's
 * statement (app/[locale]/(site)/admin/actions.ts), which updates `reports`
 * without an alias.
 *
 * A named report with a photo can be pending as well as held: the abuse
 * screen held it for a moderator (a link in its notes, say), and its flag says
 * why. Publishing it answers that flag, so the flag goes, as it always has.
 * But when the model will not answer for it by itself, because its job gave
 * up, was marked done without releasing it, or does not exist, a record
 * published with no flag would sit at 10 km and off the map for good, in no
 * list, with no way to have the model try again: a named invasive species
 * among them. So it is published with the flag the give-up writes on a
 * published held record, and the flagged list offers Classify again. A job
 * still queued or running is left to release it, or to flag it if it gives
 * up.
 *
 * Neither give-up path stamps such a report with the unidentified blur while
 * it is pending (classifyQueued): the hold already blurs it, and a stamp
 * there would be read as a decision once it was named, holding a named
 * invasive species at 10 km after the release.
 */
export const flagWhenPublished = (tx: postgres.TransactionSql) => tx`
  case when held_for_classification
        and not exists (select 1 from classification_jobs j
                         where j.report_id = reports.id
                           and j.status in ('queued', 'running'))
       then ${UNAVAILABLE_FLAG}::text end`;

/**
 * The same, for the sweep that retires a job killed during its last attempt
 * (classifyQueued). It must run before that sweep, in the same transaction,
 * and pick the jobs by the sweep's own test: the sweep's statement returns
 * the pending reports it blurred and nothing else, so afterwards nothing
 * tells a job retired a moment ago from one a moderator has since looked at.
 */
export const flagHeldAbandoned = (
  tx: postgres.TransactionSql,
  maxAttempts: number,
  staleAfter: string,
) => tx`
  update reports r
     set flagged_reason = coalesce(r.flagged_reason, ${UNAVAILABLE_FLAG})
    from classification_jobs j
   where j.report_id = r.id
     and j.status = 'running'
     and j.attempts >= ${maxAttempts}
     and j.updated_at < now() - ${staleAfter}::interval
     and r.status = 'published'
     and r.held_for_classification`;

/**
 * Put a held record's classification job back in the queue, for a moderator
 * (classifyAgain, app/[locale]/(site)/admin/actions.ts). Plain SQL in the
 * caller's transaction, so the action's own checks and log stay with it.
 *
 * Only a published record that is still held: one already released has
 * nothing to wait for. The job a worker gave up on, or one marked done
 * without releasing it, is queued again with its attempts and its error
 * cleared, so the next run claims it as if it were new; a record with no job
 * at all is given one. A job queued or running already is left alone, and
 * the answer is then null, so a second click cannot start the model twice.
 *
 * It does not release the hold, and it does not touch the blur: the record
 * stays at 10 km and off the map until the run finishes, as when it was
 * filed. It clears the flag the give-up wrote, and only that flag, because
 * the run that follows either releases the record, which would leave the
 * flag saying something no longer true, or gives up and writes it again.
 *
 * Returns the flag the record had, for the moderation log, or null when
 * nothing was queued.
 */
export async function requeueClassification(
  tx: postgres.TransactionSql,
  reportId: string,
): Promise<{ flaggedReason: string | null } | null> {
  const [report] = await tx<{ flagged_reason: string | null }[]>`
    select flagged_reason from reports
     where id = ${reportId}::uuid
       and status = 'published'
       and held_for_classification
     for update`;
  if (!report) return null;

  const live = await tx`
    select 1 from classification_jobs
     where report_id = ${reportId}::uuid
       and status in ('queued', 'running')`;
  if (live.length > 0) return null;

  const requeued = await tx`
    update classification_jobs
       set status = 'queued', attempts = 0, last_error = null, updated_at = now()
     where report_id = ${reportId}::uuid
       and status in ('failed', 'done')
    returning id`;
  if (requeued.length === 0) {
    await tx`insert into classification_jobs (report_id) values (${reportId}::uuid)`;
  }

  await tx`
    update reports
       set flagged_reason = null
     where id = ${reportId}::uuid
       and flagged_reason = ${UNAVAILABLE_FLAG}`;
  return { flaggedReason: report.flagged_reason };
}
