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

import { conditionOf, type Category } from "@conservation/shared";

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

/**
 * dwc:vitality — whether the animal was alive or dead when it was recorded.
 *
 * Read off the category, which is the page the report was filed on: the
 * roadkill page asks "dead or injured", and only `roadkill` means dead. An
 * injured animal is alive, and so is everything filed on the wildlife and
 * invasive pages. Before this term existed the only place the archive said so
 * was occurrenceRemarks, as the word "roadkill", which a GBIF user filtering
 * for dead specimens would never find. `alive` and `dead` are the TDWG
 * vocabulary's own words (dwc:vitality, issued 2023-06-28).
 */
export function vitality(category: string): "alive" | "dead" {
  return conditionOf(category as Category) === "dead" ? "dead" : "alive";
}

/**
 * dwc:establishmentMeans and dwc:degreeOfEstablishment, from TaiCOL's alien
 * status for the record's species.
 *
 * establishmentMeans says how the species came to be here: `native`, or
 * `introduced` for everything TaiCOL files as alien — invasive, naturalized,
 * cultured or cultivated. A species TaiCOL has no alien status for gets
 * nothing, because "not recorded" is not "native". So does a record with no
 * species, which is not a statement about any taxon.
 *
 * degreeOfEstablishment says `invasive` for exactly the records in the site's
 * invasive collection that name a species (reports_public.is_invasive, 0016):
 * an animal TaiCOL tags invasive, under a name it accepts. A record filed on
 * the invasive page with no species named is in that collection too, but
 * saying "invasive" of it to GBIF would be a claim about a species nobody has
 * identified. The other alien statuses are left blank rather than mapped onto
 * the TDWG vocabulary's finer steps, which TaiCOL's categories do not line up
 * with.
 *
 * TaiCOL keeps one alien status for Taiwan, Kinmen and Matsu together, so a
 * bird native only on the outlying islands (喜鵲, 鵲鴝, 黑領椋鳥, 大陸畫眉) is
 * `native` here even when it was seen on the main island, where it was
 * introduced. The note that would say so is TaiCOL's alien_status_note, which
 * the import does not keep.
 */
export function establishment(r: {
  taxon_id: number | null;
  alien_type: string | null;
  is_invasive: boolean;
}): { establishmentMeans: string; degreeOfEstablishment: string } {
  if (r.taxon_id === null || r.taxon_id === undefined)
    return { establishmentMeans: "", degreeOfEstablishment: "" };
  const alien = r.alien_type?.trim() ?? "";
  const establishmentMeans =
    alien === "native"
      ? "native"
      : ["invasive", "naturalized", "cultured", "cultivated"].includes(alien)
        ? "introduced"
        : "";
  return {
    establishmentMeans,
    degreeOfEstablishment: r.is_invasive ? "invasive" : "",
  };
}
