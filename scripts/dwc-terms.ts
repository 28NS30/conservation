/**
 * What the archive tells GBIF about a blurred coordinate, and why.
 *
 * Darwin Core has two terms for this and they go to a third party: a record
 * published here is read by people who will never see this site, and they have
 * only these sentences to judge the coordinate by.
 *
 * Both sentences used to be constants. Every obscured row said "because this
 * taxon is rated sensitive in TaiCOL" and "Exact coordinates withheld for a
 * sensitive taxon", which was true while the only reason to blur a record was
 * a sensitivity rating on its taxon.
 *
 * Migration 0011 ended that. A record nobody has identified is now blurred
 * because nobody has identified it — it has no taxon at all, so there is no
 * taxon to be rated, and the old sentence asserts two things that are not so.
 * On the production database that is 3,801 records, and the export can be run
 * with `--include-unidentified`.
 *
 * A precision_override is the third case: an identified record held at a
 * stricter precision than its own taxon's rating asks for, which is what the
 * GBIF name remap writes when correcting a name would otherwise have loosened
 * a blur. Saying "this taxon is rated sensitive" of those is also false — the
 * rating that justified the blur belonged to the name the record used to
 * carry.
 *
 * Separate from export-dwca.ts so it can be tested without opening a database
 * connection.
 */

/** Uncertainty we declare for each precision level, in metres. */
export const UNCERTAINTY: Record<string, number> = {
  // Phone GPS under tree cover, honestly stated. Claiming better would be a lie
  // that propagates into every downstream analysis.
  exact: 30,
  coarse_10km: 10_000,
  coarse_50km: 50_000,
};

export type ObscuringFacts = {
  is_obscured: boolean;
  location_precision: string;
  taxon_id: number | null;
  /** TaiCOL's sensitivity rating for that taxon, if it has one. */
  sensitivity: string | null;
  /** TaiCOL's protected status for that taxon, if it has one. */
  protected_status: string | null;
};

/** Whether TaiCOL says anything about this taxon that would justify a blur. */
function ratedSensitive(r: ObscuringFacts): boolean {
  const rated = (v: string | null) => typeof v === "string" && v.trim() !== "";
  return rated(r.sensitivity) || rated(r.protected_status);
}

/**
 * The `dataGeneralizations` and `informationWithheld` pair for one record.
 *
 * Returns empty strings for an unobscured record: Darwin Core treats an empty
 * term as "nothing to declare", and a record at full precision has nothing.
 */
export function generalisation(r: ObscuringFacts): {
  dataGeneralizations: string;
  informationWithheld: string;
} {
  if (!r.is_obscured) return { dataGeneralizations: "", informationWithheld: "" };

  const metres = UNCERTAINTY[r.location_precision];
  // An unknown precision is a schema change this file has not caught up with.
  // Saying "approximately undefined km" to GBIF is worse than saying only that
  // the coordinate was generalised.
  const km = typeof metres === "number" ? `approximately ${metres / 1000} km` : "a coarser precision";

  if (r.taxon_id === null || r.taxon_id === undefined)
    return {
      dataGeneralizations: `Coordinates generalised to ${km} because this record has not been identified, and an unidentified animal cannot be checked against the sensitive-species list`,
      informationWithheld: "Exact coordinates withheld pending identification",
    };

  if (ratedSensitive(r))
    return {
      dataGeneralizations: `Coordinates generalised to ${km} because this taxon is rated sensitive in TaiCOL`,
      informationWithheld: "Exact coordinates withheld for a sensitive taxon",
    };

  return {
    dataGeneralizations: `Coordinates generalised to ${km} by the publisher; this taxon carries no TaiCOL sensitivity rating of its own`,
    informationWithheld: "Exact coordinates withheld by the publisher",
  };
}
