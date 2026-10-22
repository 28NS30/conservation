/**
 * Whether a report is still waiting for a person to confirm what it is.
 *
 * Only reports filed on the invasive page wait for that. Everywhere else the
 * standing rule is to trust the reporter: the species they name is published,
 * and a protected one blurs itself. On the invasive page the name is the
 * doubtful part — a protected native is exactly what gets mistaken for its
 * invasive look-alike — so the record says it has not been checked until a
 * moderator confirms the species (the team's default for Q4 in the plan).
 *
 * Saying so is all this decides; it is not a blur. Since 0029 a named invasive
 * animal is published at its exact spot unless the species' own protection or
 * rating blurs it, and a report nobody has named is blurred to 10 km because
 * it is unnamed (0011), whichever page it came from. Until 0029 the invasive
 * page held every report at 10 km until a moderator checked it, which is what
 * this comment used to say.
 *
 * "Confirmed" is `taxon_source = 'expert'`: what a moderator's identification
 * is stored as, on both paths that let a moderator name a species
 * (reports/[id]/actions.ts and admin/actions.ts). A reporter agreeing with the
 * model about their own photograph is `user`, and is not a second opinion.
 *
 * Pure, so the receipt, the queue banner, /me, the record page and the record
 * lists can share it without a database, and so a test can hold it without one.
 */
export function awaitingVerification(report: {
  category: string;
  taxonSource: string | null | undefined;
}): boolean {
  return report.category === "invasive" && report.taxonSource !== "expert";
}
