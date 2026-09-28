import "server-only";
import { sql } from "@/lib/db";

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
 * Postgres evaluates every SET expression against the row as it was BEFORE the
 * update, so `taxon_id is null` here asks "did this report have a taxon before
 * this change" — which is the question — even in the same statement that is
 * setting one.
 *
 * A function rather than a constant because a postgres.js tagged template is a
 * query object, and one held at module scope and reused resolves to whatever
 * it resolved to the first time. The same trap is documented at length in
 * lib/schemaStatus.ts.
 */
export const keepDeliberateOverride = () =>
  sql`case when taxon_id is null then null else precision_override end`;

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
