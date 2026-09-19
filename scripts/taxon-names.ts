/**
 * The names TaiRON actually published, and the crosswalk that repairs them.
 *
 * Shared by `import-gbif.ts` (which must match new rows correctly) and
 * `remap-gbif-taxa.ts` (which repairs the rows imported before it did), so the
 * two can never drift into disagreeing about what a record is called.
 *
 * Background. GBIF re-files every occurrence under its own backbone taxonomy and
 * exposes that answer as `species`. For a name TaiCOL and GBIF disagree about —
 * and they disagree often, because GBIF collapses subspecies and follows
 * different synonymies — `species` is *not* what the publisher wrote. Matching on
 * it made 14 dog records into wolves and hid 747 ferret-badgers behind a taxon
 * that is not in Taiwan. The Darwin Core atoms `genericName`, `specificEpithet`
 * and `infraspecificEpithet` survive that re-filing untouched, so they are what
 * we match on first.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));

export const CROSSWALK_PATH = join(HERE, "taxon-crosswalk.json");

/** The three Darwin Core atoms a name is rebuilt from, plus GBIF's own answer. */
export type NameParts = {
  genericName?: string;
  specificEpithet?: string;
  infraspecificEpithet?: string;
  species?: string;
  scientificName?: string;
};

/**
 * The binomial or trinomial the publisher wrote, or null when the record was
 * never identified that far.
 *
 * A genus alone ("Rattus") is deliberately not a published name: it cannot match
 * a species and returning it would only push a genus string into `verbatim_name`
 * where GBIF's fuller `scientificName` ("Rattus Fischer, 1803") already sits.
 */
export function publishedName(o: NameParts): string | null {
  const genus = o.genericName?.trim();
  const species = o.specificEpithet?.trim();
  if (!genus || !species) return null;
  const infra = o.infraspecificEpithet?.trim();
  return [genus, species, infra].filter(Boolean).join(" ");
}

export type CrosswalkEntry = {
  /** TaiCOL taxon this published name refers to. */
  taicol_id: string;
  /** TaiCOL's accepted name for it, for a human reading the file. */
  scientific_name: string;
  common_name_zh: string | null;
  /** How it was resolved: `local:…` or `taicol:nameMatch`. */
  via: string;
  /** Records carrying this name at the time the crosswalk was written. */
  records: number;
};

export type Crosswalk = {
  /** Provenance, so a reader knows what produced the file and when. */
  generated_by: string;
  generated_at: string;
  /** Keyed by the published name, lower-cased. */
  names: Record<string, CrosswalkEntry>;
};

/**
 * Load the committed crosswalk. Missing is not an error: the importer works
 * without it, it just matches fewer names.
 */
export function loadCrosswalk(path = CROSSWALK_PATH): Map<string, CrosswalkEntry> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return new Map();
  }
  const parsed = JSON.parse(raw) as Crosswalk;
  return new Map(
    Object.entries(parsed.names ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
}

export type TaxonRow = {
  id: number;
  taicol_id: string;
  parent_taicol_id: string | null;
  scientific_name: string;
  common_name_zh: string | null;
  rank: string | null;
  is_in_taiwan: boolean;
  taxon_status: string | null;
  /**
   * The two fields the obscuring trigger reads. The matcher never looks at them
   * — what an animal is called cannot depend on how closely it is guarded — but
   * the remap has to compare them across a rename to see whether following a
   * name has quietly dropped a protection. See remap-gbif-taxa.ts.
   */
  sensitivity: string | null;
  protected_status: string | null;
};

/** Everything the matcher needs to know about the local `taxa` table. */
export type TaxonIndex = {
  /** lower-cased scientific name → best taxon under that name. */
  byName: Map<string, TaxonRow>;
  byTaicolId: Map<string, TaxonRow>;
};

/**
 * Match a name against local taxa, preferring one that lives in Taiwan.
 *
 * `byName` is built preferring `is_in_taiwan`, then accepted status, so a plain
 * lookup already answers "the Taiwanese taxon of that name if there is one".
 */
export function matchLocal(
  idx: TaxonIndex,
  name: string | null | undefined,
): TaxonRow | null {
  if (!name) return null;
  return idx.byName.get(name.trim().toLowerCase()) ?? null;
}

/**
 * A subspecies raised to full species keeps its own epithet and drops the
 * parent's: TaiCOL's 鼬貛 is *Melogale subaurantiaca*, published by TaiRON as
 * *Melogale moschata subaurantiaca*, and TaiCOL's 犬 is *Canis familiaris*,
 * published as *Canis lupus familiaris*. That is a rename, not a re-identification
 * — the animal named is the same one — so it is safe to follow locally.
 *
 * Only ever returns a Taiwanese accepted species: outside Taiwan the same
 * combination can name a different animal, and there we would be guessing.
 */
export function elevatedSubspecies(
  idx: TaxonIndex,
  published: string,
): TaxonRow | null {
  const parts = published.split(/\s+/);
  if (parts.length !== 3) return null;
  const hit = matchLocal(idx, `${parts[0]} ${parts[2]}`);
  if (!hit) return null;
  if (!hit.is_in_taiwan) return null;
  if (hit.taxon_status !== "accepted") return null;
  if (hit.rank !== "Species" && hit.rank !== "Subspecies") return null;
  return hit;
}

export type MatchResult = {
  taxon: TaxonRow | null;
  /** Which rule answered: `published`, `crosswalk`, `species`, or `none`. */
  via: "published" | "crosswalk" | "species" | "none";
  /** The name to keep in `verbatim_name` when nothing matched. */
  verbatim: string | null;
};

/**
 * The matcher, in the order the brief sets out.
 *
 *   1. the name TaiRON published, matched exactly against local taxa;
 *   2. the committed crosswalk, published name → TaiCOL id;
 *   3. GBIF's own `species`, but only when that taxon is in Taiwan — the check
 *      that was missing, and the reason 747 ferret-badgers sat on a taxon the
 *      species directory does not list;
 *   4. no taxon, and the name kept verbatim.
 *
 * TaiRON's identification stands throughout. This translates names between two
 * checklists; it never decides that a record is a different animal.
 */
export function matchTaxon(
  idx: TaxonIndex,
  crosswalk: Map<string, CrosswalkEntry>,
  o: NameParts,
): MatchResult {
  const published = publishedName(o);
  const gbifName = (o.species ?? o.scientificName ?? "").trim() || null;
  const verbatim = published ?? gbifName;

  if (published) {
    const exact = matchLocal(idx, published);
    if (exact) return { taxon: exact, via: "published", verbatim: null };

    const mapped = crosswalk.get(published.toLowerCase());
    const viaCrosswalk = mapped ? idx.byTaicolId.get(mapped.taicol_id) : null;
    if (viaCrosswalk)
      return { taxon: viaCrosswalk, via: "crosswalk", verbatim: null };
  }

  const bySpecies = matchLocal(idx, o.species);
  if (bySpecies?.is_in_taiwan)
    return { taxon: bySpecies, via: "species", verbatim: null };

  return { taxon: null, via: "none", verbatim };
}

/**
 * Load `taxa` into the shape the matcher wants.
 *
 * Ordering is the whole point of the index: `is_in_taiwan` first, then accepted
 * status, so a bare `byName` lookup already answers "the Taiwanese taxon of that
 * name, if there is one". `byTaicolId` covers every rank, because a crosswalk
 * entry may point at a taxon the name index does not hold.
 */
export async function loadTaxonIndex(sql: Sql): Promise<TaxonIndex> {
  const rows = await sql<TaxonRow[]>`
    select id, taicol_id, parent_taicol_id, scientific_name, common_name_zh, rank,
           is_in_taiwan, taxon_status, sensitivity, protected_status
      from taxa
     order by is_in_taiwan desc, (taxon_status = 'accepted') desc, id`;
  const byName = new Map<string, TaxonRow>();
  const byTaicolId = new Map<string, TaxonRow>();
  for (const r of rows) {
    if (r.rank === "Species" || r.rank === "Subspecies") {
      const k = r.scientific_name.toLowerCase();
      if (!byName.has(k)) byName.set(k, r);
    }
    if (!byTaicolId.has(r.taicol_id)) byTaicolId.set(r.taicol_id, r);
  }
  return { byName, byTaicolId };
}
