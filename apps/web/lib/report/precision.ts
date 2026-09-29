import "server-only";
import { sql } from "@/lib/db";
import { UNIDENTIFIED_PRECISION } from "@conservation/shared";

/**
 * What naming a report is allowed to do to its blur.
 *
 * Three paths set `taxon_id` — the reporter or a moderator confirming a
 * species, a moderator correcting one from the console, and the classifier
 * assigning one — and all three used to disagree about `precision_override`.
 * Two cleared it unconditionally and one never touched it, which meant the
 * same correction had two different consequences for a location depending on
 * which screen it was made from.
 *
 * The rule they now share: clear the STAMP, never a DECISION.
 *
 *   - An override on a report with no taxon is the system's own "we do not
 *     know what this is yet", written at submission or by a low-confidence
 *     classification. Naming the animal is exactly what it was waiting for, so
 *     precision goes back to the named taxon's own policy.
 *
 *   - An override on a report that ALREADY has a taxon is a decision that this
 *     record stays coarser than its rating asks. The GBIF name remap wrote 371
 *     of them, for records whose old name justified a blur the corrected name
 *     would not. Clearing those publishes a location somebody withheld.
 *
 *   - An override on a report filed on the invasive page is a decision too,
 *     named or not (UNVERIFIED_INVASIVE_PRECISION, packages/shared). It holds
 *     the record at 10 km until a person has checked the species, because the
 *     species is the doubtful part: a protected native taken for its invasive
 *     look-alike. Clearing it when an unnamed one was named would have
 *     published exactly that guess — a reporter tapping one of the model's
 *     suggestions on their own report is enough — so it is kept, by every
 *     path, and a moderator's confirmation does not lift it either. When it
 *     may be lifted is the owner's decision, not this file's.
 *
 * Postgres evaluates every SET expression against the row as it was BEFORE the
 * update, so `taxon_id is null` here asks "did this report have a taxon before
 * this change" — which is the question — even in the same statement that is
 * setting one. `category` likewise reads the page it was filed on, even where
 * the same statement re-derives it.
 *
 * A function rather than a constant because a postgres.js tagged template is a
 * query object, and one held at module scope and reused resolves to whatever
 * it resolved to the first time. The same trap is documented at length in
 * lib/schemaStatus.ts.
 */
export const keepDeliberateOverride = () =>
  sql`case when taxon_id is null and category is distinct from 'invasive' then null else precision_override end`;

/**
 * The same rule, for a species named from a photograph, plus the one thing a
 * photograph cannot settle.
 *
 * A model cannot tell 環頸雉's protected endemic subspecies from its
 * introduced ones, and its label list holds deleted rows and duplicates beside
 * the accepted ones, which need not carry the same rating. Which of several
 * rows sharing a binomial it lands on is noise, so the record is blurred at
 * least as hard as the strictest of them (`binomial_precision_floor`,
 * migration 0014). When the taxon's own rule is already that strict this adds
 * nothing, and nothing is stamped.
 *
 * Built on keepDeliberateOverride rather than beside it, so the three paths
 * that name a species still share one rule about what an override means.
 */
export const photoIdentificationOverride = (taxonId: number) =>
  sql`stricter_precision(${keepDeliberateOverride()}, binomial_precision_floor(${taxonId}))`;

/**
 * The blur for a record the model only made suggestions for.
 *
 * Such a record stays unidentified, at the unidentified blur — and, when its
 * suggestions are shown, at least at the strictest rule among them. The page
 * for the record lists them publicly (`report_ai_suggestions`, 0006) beside its
 * location, so a medium-band photograph of a 重度 animal was published as
 * "probably X" at 10 km, looser than the 50 km its own record would get, and a
 * 座標不開放 one as "probably X" within 10 km of where it was seen. Measured
 * top-5 accuracy in that band is 91.6%: the list is usually right, which is
 * what makes it worth blurring for. Each candidate counts at its binomial's
 * strictest, as a named one would (`photoIdentificationOverride`). A record
 * that comes out suppressed leaves the public view, and its suggestions with it.
 *
 * In the low band the suggestions are withheld, so there is nothing to blur
 * for, and a list that is wrong a third of the time should not take a record
 * off the map.
 *
 * Never looser than the override already there. The record may be held
 * coarser on purpose — by a moderator, or at submission because the name the
 * reporter gave is one we no longer offer (app/api/reports/route.ts) — and a
 * classification is not a decision to publish it more exactly.
 */
export const suggestionOverride = (reportId: string, suggestionsShown: boolean) =>
  suggestionsShown
    ? sql`stricter_precision(precision_override, stricter_precision(${UNIDENTIFIED_PRECISION}::text,
            (select c.p
               from (select binomial_precision(c.taxon_id) as p
                       from classifications c
                      where c.report_id = ${reportId}::uuid) c
              order by precision_rank(c.p) desc
              limit 1)))`
    : sql`stricter_precision(precision_override, ${UNIDENTIFIED_PRECISION}::text)`;
