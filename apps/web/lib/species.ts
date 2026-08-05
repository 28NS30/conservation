import { asPublic } from "@/lib/db";

export type SpeciesSummary = {
  id: number;
  scientificName: string;
  nameAuthor: string | null;
  commonNameZh: string | null;
  altNamesZh: string[] | null;
  rank: string | null;
  family: string | null;
  reportCount: number;
  protectedStatus: string | null;
  isEndemic: boolean;
  isInvasive: boolean;
  sensitivity: string | null;
};

export type SpeciesDetail = SpeciesSummary & {
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  genus: string | null;
  cites: string | null;
  iucn: string | null;
  redlist: string | null;
  alienType: string | null;
  isTerrestrial: boolean | null;
  isFreshwater: boolean | null;
  isBrackish: boolean | null;
  isMarine: boolean | null;
  firstSeen: string | null;
  lastSeen: string | null;
};

/**
 * Everything below reads `species_report_stats`, which is built on
 * `reports_public`. Counting from the `reports` base table would leak the record
 * volume of 座標不開放 taxa, which is exactly what the obscuring design exists to
 * prevent.
 */
const SUMMARY_COLS = `
  t.id, t.scientific_name as "scientificName", t.name_author as "nameAuthor",
  t.common_name_zh as "commonNameZh", t.alt_names_zh as "altNamesZh",
  t.rank, t.family, t.protected_status as "protectedStatus",
  t.is_endemic as "isEndemic", t.is_invasive as "isInvasive", t.sensitivity,
  coalesce(s.report_count, 0) as "reportCount"`;

/** URL slug: `32116-prionailurus-bengalensis`. Ids stay stable; humans get a hint. */
export function speciesSlug(s: { id: number; scientificName: string }): string {
  const name = s.scientificName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return name ? `${s.id}-${name}` : String(s.id);
}

/** Accepts `32116` or `32116-anything`; anything else is not a species id. */
export function parseSpeciesId(param: string): number | null {
  const m = /^(\d+)(?:-|$)/.exec(param);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function getSpecies(id: number): Promise<SpeciesDetail | null> {
  const rows = await asPublic(
    (tx) => tx<SpeciesDetail[]>`
      select ${tx.unsafe(SUMMARY_COLS)},
             t.kingdom, t.phylum, t.class, t."order", t.genus,
             t.cites, t.iucn, t.redlist, t.alien_type as "alienType",
             t.is_terrestrial as "isTerrestrial", t.is_freshwater as "isFreshwater",
             t.is_brackish as "isBrackish", t.is_marine as "isMarine",
             s.first_seen as "firstSeen", s.last_seen as "lastSeen"
        from taxa t
        left join species_report_stats s on s.taxon_id = t.id
       where t.id = ${id}`,
  );
  return rows[0] ?? null;
}

/**
 * Directory listing.
 *
 * Defaults to species that actually have records: only 354 of 66,201 taxa do, so
 * an unfiltered list is 65,850 empty pages and useless as a directory.
 */
export async function listSpecies(opts: {
  q?: string;
  filter?: "recorded" | "all" | "invasive" | "protected" | "endemic";
  limit?: number;
  offset?: number;
}): Promise<SpeciesSummary[]> {
  const { q, filter = "recorded", limit = 60, offset = 0 } = opts;
  const like = q ? `%${q}%` : null;
  const exact = q ? [q] : null;

  return asPublic(
    (tx) => tx<SpeciesSummary[]>`
      select ${tx.unsafe(SUMMARY_COLS)}
        from taxa t
        left join species_report_stats s on s.taxon_id = t.id
       where t.is_in_taiwan
         and t.rank in ('Species','Subspecies')
         and (${filter}::text <> 'recorded'  or s.report_count is not null)
         and (${filter}::text <> 'invasive'  or t.is_invasive)
         and (${filter}::text <> 'protected' or t.protected_status is not null)
         and (${filter}::text <> 'endemic'   or t.is_endemic)
         and (
           ${like}::text is null
           or t.scientific_name ilike ${like}
           or t.common_name_zh like ${like}
           or t.alt_names_zh && ${exact}::text[]
         )
       -- Species with records first: someone searching 石虎 wants the page with
       -- data, not an arbitrary synonym entry that has none.
       order by (s.report_count is null), s.report_count desc nulls last,
                t.common_name_zh nulls last, t.scientific_name
       limit ${limit} offset ${offset}`,
  );
}

/** Monthly distribution — roadkill is strongly seasonal, so this is the most scientifically useful chart on the page. */
export async function monthlyCounts(taxonId: number): Promise<number[]> {
  const rows = await asPublic(
    (tx) => tx<{ month: number; n: number }[]>`
      select extract(month from observed_at)::int as month, count(*)::int as n
        from reports_public where taxon_id = ${taxonId}
       group by 1 order by 1`,
  );
  const out = Array(12).fill(0);
  for (const r of rows) out[r.month - 1] = r.n;
  return out;
}

/** Individual records, for species too sparse to justify a heatmap. */
export async function recentRecords(taxonId: number, limit = 12) {
  return asPublic(
    (tx) => tx<
      { id: string; observedAt: string; lat: number; lng: number; category: string; isObscured: boolean }[]
    >`
      select id, observed_at as "observedAt",
             st_y(location_public::geometry) as lat,
             st_x(location_public::geometry) as lng,
             category, is_obscured as "isObscured"
        from reports_public
       where taxon_id = ${taxonId}
       order by observed_at desc
       limit ${limit}`,
  );
}
