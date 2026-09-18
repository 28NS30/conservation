import type postgres from "postgres";
import { asPublic } from "@/lib/db";

export type SpeciesFilter =
  | "recorded"
  | "all"
  | "invasive"
  | "protected"
  | "endemic";

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

/**
 * Whether a species page carries something a searcher could actually want.
 *
 * The old rule was `reportCount === 0 -> noindex`, which left 458 of 66,201
 * pages indexable. That was the right instinct aimed at the wrong test: it
 * assumed the only thing worth indexing is our own data, when the page also
 * renders a name, an authority, a lineage, a habitat and up to four
 * conservation assessments from the TaiCOL checklist — none of which needs a
 * user to have reported anything.
 *
 * Counting facts does not work either: 48,273 species clear "four or more",
 * and four generic fields repeated 48,273 times is exactly the mass of
 * near-identical thin pages the original comment was afraid of.
 *
 * So the test is whether the page says something DISTINGUISHING — a
 * conservation status, records of our own, endemism or invasiveness, or the
 * Chinese names people actually search by. That admits 24,243 pages, and every
 * one of them answers a question somebody might have typed.
 */
export function isIndexworthy(s: {
  reportCount: number;
  protectedStatus: string | null;
  iucn?: string | null;
  redlist?: string | null;
  cites?: string | null;
  isEndemic: boolean;
  isInvasive: boolean;
  commonNameZh: string | null;
  altNamesZh: string[] | null;
}): boolean {
  return Boolean(
    s.reportCount > 0 ||
    s.protectedStatus ||
    s.iucn ||
    s.redlist ||
    s.cites ||
    s.isEndemic ||
    s.isInvasive ||
    (s.commonNameZh && s.altNamesZh && s.altNamesZh.length > 0),
  );
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
 * Which taxa a directory query is about.
 *
 * Shared by the listing and the count, and shared rather than written twice
 * because the count is what the pager divides by: a count that selected a
 * slightly different set from the list would put the reader on a last page that
 * is empty, or stop the pager one page before the end of the results. Every
 * such bug is invisible until someone reaches the boundary.
 *
 * Both callers join `species_report_stats` as `s` and `taxa` as `t`.
 */
function speciesWhere(
  tx: postgres.TransactionSql,
  filter: SpeciesFilter,
  like: string | null,
) {
  return tx`
         t.is_in_taiwan
     and t.rank in ('Species','Subspecies')
     and (${filter}::text <> 'recorded'  or s.report_count is not null)
     and (${filter}::text <> 'invasive'  or t.is_invasive)
     and (${filter}::text <> 'protected' or t.protected_status is not null)
     and (${filter}::text <> 'endemic'   or t.is_endemic)
     and (
       ${like}::text is null
       or t.scientific_name ilike ${like}
       or t.common_name_zh like ${like}
       -- Matched with LIKE rather than array overlap, which only ever
       -- matched a whole alternate name. TaiCOL stores the iguana as 綠鬛蜥
       -- and 綠鬣蜥 only as an alternate, so typing the spelling our own
       -- front page uses found the species and typing part of it found
       -- nothing at all.
       or exists (
         select 1 from unnest(t.alt_names_zh) a where a like ${like}
       )
     )`;
}

/** How many taxa the same query matches, for the directory's pager. */
export async function countSpecies(opts: {
  q?: string;
  filter?: SpeciesFilter;
}): Promise<number> {
  const { q, filter = "recorded" } = opts;
  const like = q ? `%${q}%` : null;
  const rows = await asPublic(
    (tx) => tx<{ n: number }[]>`
      select count(*)::int as n
        from taxa t
        left join species_report_stats s on s.taxon_id = t.id
       where ${speciesWhere(tx, filter, like)}`,
  );
  return rows[0]?.n ?? 0;
}

/**
 * Directory listing.
 *
 * Defaults to species that actually have records: only 354 of 66,201 taxa do, so
 * an unfiltered list is 65,850 empty pages and useless as a directory.
 */
export async function listSpecies(opts: {
  q?: string;
  filter?: SpeciesFilter;
  /**
   * Order native species first without excluding anything else.
   *
   * For the report form: someone naming a wildlife sighting almost always means
   * a native species, but a roadkill victim is very often not one — feral
   * pigeons and mynas account for 1,341 of our records. Ranking gets the common
   * case to the top; excluding would hide the animal in front of the reporter.
   */
  preferNative?: boolean;
  limit?: number;
  offset?: number;
}): Promise<SpeciesSummary[]> {
  const {
    q,
    filter = "recorded",
    preferNative = false,
    limit = 60,
    offset = 0,
  } = opts;
  const term = q ?? null;
  const like = q ? `%${q}%` : null;
  const prefix = q ? `${q}%` : null;

  return asPublic(
    (tx) => tx<SpeciesSummary[]>`
      select ${tx.unsafe(SUMMARY_COLS)}
        from taxa t
        left join species_report_stats s on s.taxon_id = t.id
       where ${speciesWhere(tx, filter, like)}
       -- Relevance first, and it has to be: searching 石虎 returned 豹貓 (its own
       -- alternate name) and 前鰭吻鮋 above the species actually called 石虎,
       -- because the only ordering was by record count. That is tolerable in a
       -- directory and useless in a picker, where the reporter types the name of
       -- the animal in front of them and expects it first.
       order by
         case
           when ${term}::text is null then 3
           when t.common_name_zh = ${term}
             or t.scientific_name ilike ${term}
             -- An exact alternate name counts as exact, not as a lesser match.
             -- 石虎 is the common name of the subspecies euptilurus and an
             -- alternate for the species itself, which is the row holding all
             -- 46,334 records; ranking the exact common name above it sent a
             -- reporter to a page with nothing on it. Tie broken by records
             -- below, which is the only evidence we have about which name is
             -- actually used for which taxon.
             or exists (select 1 from unnest(t.alt_names_zh) a where a = ${term})
             then 0
           when t.common_name_zh like ${prefix} or t.scientific_name ilike ${prefix} then 1
           else 2
         end,
         (${preferNative}::boolean and t.alien_type is distinct from 'native'),
         (s.report_count is null), s.report_count desc nulls last,
         -- Among equally-exact, equally-recorded matches, the taxon actually
         -- called that comes before one that merely lists it as an alternate:
         -- 石虎 is also an alternate name for 前鰭吻鮋, a scorpionfish.
         (t.common_name_zh is distinct from ${term}),
         t.common_name_zh nulls last, t.scientific_name,
         -- The tiebreak that makes paging trustworthy. Every key above can be
         -- equal between two rows — 1,295 Taiwanese taxa share a scientific
         -- name with at least one other — and rows that compare equal come
         -- back in whatever order the plan produced them, which need not be
         -- the same order across two LIMIT/OFFSET queries. The reader then
         -- sees one species twice and never sees another. t.id is unique, so
         -- it makes the ordering total.
         t.id
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
      {
        id: string;
        observedAt: string;
        lat: number;
        lng: number;
        category: string;
        isObscured: boolean;
      }[]
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
