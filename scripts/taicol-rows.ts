/**
 * One TaiCOL taxon as `taxa` stores it: the API's shape, the mapping, and the
 * columns an import writes. Shared by scripts/import-taicol.ts, which writes
 * them to DATABASE_URL, and scripts/taicol-sql.ts, which writes them as SQL for
 * a database this machine cannot reach (production, through the Management
 * API). One mapping, so the two cannot write different things.
 *
 * No database import here on purpose: scripts/db.ts connects when it is
 * loaded, and the SQL writer has nothing to connect to.
 */

export type TaicolTaxon = {
  taxon_id: string;
  parent_taxon_id: string | null;
  taxon_status: string | null;
  simple_name: string;
  name_author: string | null;
  common_name_c: string | null;
  alternative_name_c: string | null;
  rank: string | null;
  kingdom: string | null;
  is_in_taiwan: boolean | null;
  is_endemic: boolean | null;
  alien_type: string | null;
  /**
   * TaiCOL's note on alien status by region, e.g. "臺灣: 引進種" for a bird that
   * is native to Kinmen and Matsu but introduced on the main island, which
   * alien_type (one value for all three) cannot say. Kept since migration 0023.
   */
  alien_status_note: string | null;
  protected: string | null;
  cites: string | null;
  iucn: string | null;
  redlist: string | null;
  sensitive: string | null;
  is_terrestrial: boolean | null;
  is_freshwater: boolean | null;
  is_brackish: boolean | null;
  is_marine: boolean | null;
  updated_at: string | null;
};

export type Page = { info: { total: number }; data: TaicolTaxon[] };

export function toRow(t: TaicolTaxon) {
  const alt = t.alternative_name_c
    ? t.alternative_name_c.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  return {
    taicol_id: t.taxon_id,
    parent_taicol_id: t.parent_taxon_id,
    taxon_status: t.taxon_status,
    scientific_name: t.simple_name,
    name_author: t.name_author,
    common_name_zh: t.common_name_c,
    alt_names_zh: alt,
    rank: t.rank,
    kingdom: t.kingdom,
    is_in_taiwan: t.is_in_taiwan ?? false,
    is_endemic: t.is_endemic ?? false,
    alien_type: t.alien_type,
    alien_status_note: t.alien_status_note ?? null,
    // TaiCOL encodes invasiveness inside alien_type rather than as a flag.
    is_invasive: (t.alien_type ?? "").toLowerCase().includes("invasive"),
    // Overwritten on every run, so a hand edit to either never lasts. Where
    // TaiCOL's value is too lenient — the law protects an animal under a name
    // TaiCOL has moved, or TaiCOL relaxes a rating — the fix goes in
    // scripts/taxa-overrides.csv, which this import never touches and which
    // the blur takes the stricter of (migration 0014).
    protected_status: t.protected,
    cites: t.cites,
    iucn: t.iucn,
    redlist: t.redlist,
    sensitivity: t.sensitive,
    is_terrestrial: t.is_terrestrial,
    is_freshwater: t.is_freshwater,
    is_brackish: t.is_brackish,
    is_marine: t.is_marine,
    updated_at: t.updated_at ? new Date(t.updated_at) : null,
  };
}

export const COLUMNS = [
  "taicol_id", "parent_taicol_id", "taxon_status", "scientific_name", "name_author",
  "common_name_zh", "alt_names_zh", "rank", "kingdom", "is_in_taiwan", "is_endemic",
  "alien_type", "alien_status_note", "is_invasive", "protected_status", "cites", "iucn", "redlist",
  "sensitivity", "is_terrestrial", "is_freshwater", "is_brackish", "is_marine", "updated_at",
] as const;

