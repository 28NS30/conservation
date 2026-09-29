/**
 * Whether a report is still waiting for a person to confirm what it is.
 *
 * Only reports filed on the invasive page wait for that. Everywhere else the
 * standing rule is to trust the reporter: the species they name is published,
 * and a protected one blurs itself. On the invasive page the name is the
 * doubtful part — a protected native is exactly what gets mistaken for its
 * invasive look-alike — so the record is public but blurred to at least 10 km,
 * and says it has not been checked, until a moderator confirms the species
 * (the team's default for Q4 in the plan).
 *
 * "Confirmed" is `taxon_source = 'expert'`: what a moderator's identification
 * is stored as, on both paths that let a moderator name a species
 * (reports/[id]/actions.ts and admin/actions.ts). A reporter agreeing with the
 * model about their own photograph is `user`, and is not a second opinion.
 *
 * Pure, so the receipt, the queue banner and /me can share it without a
 * database, and so a test can hold it without one.
 */
export function awaitingVerification(report: {
  category: string;
  taxonSource: string | null | undefined;
}): boolean {
  return report.category === "invasive" && report.taxonSource !== "expert";
}
