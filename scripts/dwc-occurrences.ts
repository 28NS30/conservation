/**
 * Which of our records may go into the Darwin Core Archive, and what each one
 * says about itself.
 *
 * Separate from export-dwca.ts so it can be tested against a database
 * transaction without writing an archive, and without that script's own
 * connection: a test's rolled-back fixtures are invisible to any other
 * connection, so the query has to run on the connection the test hands in.
 *
 * TWO THINGS THIS REFUSES TO PUBLISH, both because nobody said we could.
 *
 * A licence nobody granted. The archive is a statement to GBIF, and through it
 * to every downstream user, of the terms each record may be reused under. The
 * report form has never asked a contributor for a licence, so a user record
 * carries none; this used to fill the gap with the dataset's own CC BY 4.0,
 * asserting on the reporter's behalf a grant they never made. A record is
 * exported under the licence it carries or not at all. When the form starts
 * asking (the contributor terms in the plan), those records start appearing
 * here with no change to this file.
 *
 * The reporter's notes. Free text written into a report form, by someone who
 * was told it was a note to us — it can hold a name, a phone number, a house
 * or a precise place in words, which is the one thing the coordinate blur
 * cannot reach. It is not selected, so it cannot leak by any later edit to the
 * mapping below.
 */
import type postgres from "postgres";
import { UNCERTAINTY, generalisation } from "./dwc-terms.ts";

/**
 * Column order here defines the archive. `meta.xml` is generated from this same
 * list, so the two cannot drift — a mismatched meta.xml is the single most common
 * way a DwC-A is rejected, and it fails silently as misaligned columns.
 */
export const TERMS = [
  "occurrenceID",
  "basisOfRecord",
  "eventDate",
  "year",
  "month",
  "day",
  "countryCode",
  "decimalLatitude",
  "decimalLongitude",
  "geodeticDatum",
  "coordinateUncertaintyInMeters",
  "scientificName",
  "taxonID",
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "taxonRank",
  "vernacularName",
  "identificationVerificationStatus",
  "occurrenceRemarks",
  "occurrenceStatus",
  "dataGeneralizations",
  "informationWithheld",
  "license",
  "rightsHolder",
  "datasetName",
] as const;

export type Term = (typeof TERMS)[number];

/**
 * How the identification was arrived at, in GBIF's controlled-ish vocabulary.
 *
 * `user` is NOT "verified". It is the reporter agreeing with one of the
 * classifier's own suggestions for their own photograph — one person, no second
 * opinion. "Verified by" is a claim about a second party, and on that path there
 * is no second party; a downstream modeller filtering for verified records would
 * have been handed self-assertions. Only `expert` involves someone other than
 * the reporter, and only that one says verified.
 */
const VERIFICATION: Record<string, string> = {
  user: "Unverified — reporter's own identification",
  expert: "Verified by moderator",
  ai: "Unverified — machine identification above measured confidence threshold",
  imported: "Unverified",
};

export type OccurrenceRow = {
  id: string;
  category: string;
  /** postgres.js parses timestamptz into a Date, not a string. */
  observed_at: Date;
  location_precision: string;
  is_obscured: boolean;
  /** Read only to say WHY a coordinate was generalised; never published itself. */
  sensitivity: string | null;
  protected_status: string | null;
  taxon_source: string | null;
  lat: number | null;
  lng: number | null;
  scientific_name: string | null;
  taxon_id: number | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  rank: string | null;
  common_name_zh: string | null;
  license: string | null;
  rights_holder: string | null;
  source: string;
};

/**
 * The candidate rows: our own published records, never an imported one.
 *
 * Reads `reports_public`, so coordinates are already obscured for sensitive
 * taxa and suppressed records are absent. Joining `taxa` is for names and for
 * the reason a coordinate is coarse. `notes` is deliberately not selected.
 */
export function selectOccurrences(
  sql: postgres.Sql | postgres.TransactionSql,
  opts: { includeUnidentified: boolean },
) {
  return sql<OccurrenceRow[]>`
    select r.id::text, r.category, r.observed_at,
           r.location_precision, r.is_obscured, r.taxon_source, r.source,
           r.license, r.rights_holder,
           st_y(r.location_public::geometry) as lat,
           st_x(r.location_public::geometry) as lng,
           t.scientific_name, t.id as taxon_id, t.kingdom, t.phylum, t.class,
           t."order", t.family, t.genus, t.rank, t.common_name_zh,
           t.sensitivity, t.protected_status
      from reports_public r
      left join taxa t on t.id = r.taxon_id
     where r.source = 'user'
       and r.location_precision <> 'suppressed'
       and (${opts.includeUnidentified} or r.taxon_id is not null)
     order by r.observed_at`;
}

/** The licence a record carries itself, or null when nobody granted one. */
export function licenceOf(r: Pick<OccurrenceRow, "license">): string | null {
  const l = r.license?.trim();
  return l ? l : null;
}

/**
 * One record as Darwin Core, or null when it may not be published.
 *
 * `datasetTitle` names the dataset the record belongs to; it is not a licence
 * and nothing here borrows one from the dataset.
 */
export function toOccurrence(
  r: OccurrenceRow,
  datasetTitle: string,
): Record<Term, unknown> | null {
  const license = licenceOf(r);
  if (!license) return null;

  const d = new Date(r.observed_at);
  // Why this coordinate is coarse, decided per record rather than asserted.
  // See scripts/dwc-terms.ts: since 0011 a record can be blurred because
  // nobody has identified it, which is not a statement about any taxon.
  const withheld = generalisation(r);

  return {
    // Stable and opaque. A UUID means republishing after an edit updates the
    // existing GBIF occurrence instead of creating a duplicate.
    occurrenceID: r.id,
    basisOfRecord: "HumanObservation",
    eventDate: r.observed_at ? r.observed_at.toISOString() : "",
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    countryCode: "TW",
    decimalLatitude: r.lat?.toFixed(6),
    decimalLongitude: r.lng?.toFixed(6),
    geodeticDatum: "EPSG:4326",
    coordinateUncertaintyInMeters: UNCERTAINTY[r.location_precision] ?? "",
    scientificName: r.scientific_name,
    taxonID: r.taxon_id ? `TaiCOL:${r.taxon_id}` : "",
    kingdom: r.kingdom,
    phylum: r.phylum,
    class: r.class,
    order: r.order,
    family: r.family,
    genus: r.genus,
    taxonRank: r.rank?.toLowerCase(),
    vernacularName: r.common_name_zh,
    identificationVerificationStatus: VERIFICATION[r.taxon_source ?? ""] ?? "Unverified",
    // The report category only, which is real ecological signal: "roadkill" is
    // how the animal was encountered. Never the reporter's notes; see above.
    occurrenceRemarks: r.category,
    occurrenceStatus: "present",
    dataGeneralizations: withheld.dataGeneralizations,
    informationWithheld: withheld.informationWithheld,
    license,
    rightsHolder: r.rights_holder ?? datasetTitle,
    datasetName: datasetTitle,
  };
}
