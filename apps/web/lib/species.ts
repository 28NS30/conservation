import type postgres from "postgres";
import { cache } from "react";
import {
  REPORT_PAGES,
  REPORT_PAGE_KEYS,
  type ReportPage,
  type SpeciesScope,
} from "@conservation/shared";
import { asPublic } from "@/lib/db";
import { siteFigure } from "@/lib/siteFigures";
import { speciesSlug } from "@/lib/speciesSlug";
import { selectionFor, type Collection } from "@conservation/shared";

export type SpeciesFilter =
  | "recorded"
  | "all"
  | "invasive"
  | "protected"
  | "endemic";

export type SpeciesSummary = {
  id: number;
  /** Stable across imports, unlike id; keys lib/speciesNotes.ts. */
  taicolId: string;
  scientificName: string;
  nameAuthor: string | null;
  commonNameZh: string | null;
  altNamesZh: string[] | null;
  /**
   * From migration 0015 and scripts/english-names.json. Null where no source
   * we trust names it: the page then shows no English name, never a guess.
   */
  commonNameEn: string | null;
  /** Search-only: other English names and spellings ("Grey Heron"). */
  altNamesEn: string[] | null;
  rank: string | null;
  family: string | null;
  reportCount: number;
  protectedStatus: string | null;
  isEndemic: boolean;
  isInvasive: boolean;
  sensitivity: string | null;
};

export type SpeciesDetail = SpeciesSummary & {
  /** Whether a reporter can file under this name; see OFFERED. */
  offered: boolean;
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
  /** TaiCOL's note on the taxon's alien status, where it has one (0023). */
  alienStatusNote: string | null;
};

/**
 * Everything below reads `species_report_stats`, which is built on
 * `reports_public`, or `species_card_stats`, which is built on it. Counting
 * from the `reports` base table would leak the record volume of 座標不開放
 * taxa, which is exactly what the obscuring design exists to prevent.
 *
 * ONE CARD PER SPECIES AND NAME (migration 0040). TaiCOL keeps 家燕 as a
 * species row and three subspecies rows, all called 家燕, and the directory
 * printed each as a card of its own: the same title three times, with the
 * records split between them. A subspecies that has its species' Chinese name
 * is now shown on the species' card. A subspecies with a name of its own,
 * 石虎 under 豹貓, keeps its own card, and so does each of two subspecies that
 * share a name their species does not use: neither is the other's species.
 * `species_folds` says which subspecies fold into which species, and never
 * folds one blurred by a different rule or flagged invasive differently.
 *
 * Display only. Every row keeps its own page, and a report is still filed,
 * blurred and counted under the taxon it names: OFFERED below still offers
 * every subspecies, so a report queued offline under one still files.
 */
const SUMMARY_COLS = `
  t.id, t.taicol_id as "taicolId", t.scientific_name as "scientificName", t.name_author as "nameAuthor",
  t.common_name_zh as "commonNameZh", t.alt_names_zh as "altNamesZh",
  t.common_name_en as "commonNameEn", t.alt_names_en as "altNamesEn",
  t.rank, t.family, t.protected_status as "protectedStatus",
  t.is_endemic as "isEndemic", t.is_invasive as "isInvasive", t.sensitivity,
  coalesce(s.report_count, 0) as "reportCount"`;

/**
 * A name a reporter can file a report under: one TaiCOL still accepts, for an
 * animal recorded in Taiwan.
 *
 * One definition because three places ask and they disagreed. The picker and
 * the directory offered only these, `POST /api/reports` accepted only these,
 * and the report form's "report this species" prefill, reached from any
 * species page, took whatever id it was given. A species page for a retired
 * name therefore sent its visitor into a report the server would not file as
 * named — and a report queued offline is marked failed on any 4xx, with no way
 * to choose again, so the observation was lost.
 *
 * A species or subspecies, as the picker offers: a species page for a family
 * or a genus (Felidae, 99 such pages are protected or invasive as a group)
 * showed "be the first to report it" and opened the form on a name nobody
 * could pick.
 *
 * Every subspecies stays OFFERED, those shown on their species' card
 * (species_folds) too. The picker lists cards, so it shows 家燕 once and files
 * a new report under the species; but a report already queued offline under
 * a subspecies of the same name must still be filed when it is sent.
 *
 * `t` is `taxa`. `is not distinct from` because `taxon_status` is nullable.
 */
export const OFFERED = `(t.taxon_status is not distinct from 'accepted' and t.is_in_taiwan
  and t.rank in ('Species', 'Subspecies'))`;

/**
 * Whether a taxon is one a report page offers, beyond being OFFERED at all:
 * the page's kingdom, the ranks the picker lists, and for the invasive page
 * only the species TaiCOL tags invasive.
 *
 * One definition, read by the picker's search and by `POST /api/reports`, for
 * the reason OFFERED is one definition: the two disagreeing is either a
 * reporter refused a species they were offered, or a native animal filed as
 * an invasive one. The scope itself is data in packages/shared (REPORT_PAGES).
 *
 * Spliced into SQL, so nothing in it comes from a request: the kingdom is
 * checked against the one value the type allows before it is written in.
 *
 * `t` is `taxa`.
 */
export function inPageScope(scope: SpeciesScope): string {
  if (scope.kingdom !== "Animalia")
    throw new Error(`no report page offers the kingdom ${scope.kingdom}`);
  return `(t.kingdom = 'Animalia' and t.rank in ('Species','Subspecies')${
    scope.invasiveOnly ? " and t.is_invasive" : ""
  })`;
}

export { speciesSlug, parseSpeciesId } from "@/lib/speciesSlug";

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
  rank?: string | null;
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
  // A family or a genus page has a name and a lineage and nothing else of its
  // own; the species under it are the pages worth finding.
  if (s.rank && s.rank !== "Species" && s.rank !== "Subspecies") return false;
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

/**
 * One species, as its page and its share card show it. The records are the
 * card's (speciesMembers): a species page counts the subspecies shown on its
 * card too, as the directory does, and a folded subspecies' own page counts
 * its own.
 */
async function readSpecies(id: number): Promise<SpeciesDetail | null> {
  const rows = await asPublic(
    (tx) => tx<SpeciesDetail[]>`
      select ${tx.unsafe(SUMMARY_COLS)},
             ${tx.unsafe(OFFERED)} as offered,
             t.kingdom, t.phylum, t.class, t."order", t.genus,
             t.cites, t.iucn, t.redlist, t.alien_type as "alienType",
             t.is_terrestrial as "isTerrestrial", t.is_freshwater as "isFreshwater",
             t.is_brackish as "isBrackish", t.is_marine as "isMarine",
             nullif(trim(t.alien_status_note), '') as "alienStatusNote",
             s.first_seen as "firstSeen", s.last_seen as "lastSeen"
        from taxa t
        left join lateral (
          select nullif(count(*), 0)::int as report_count,
                 min(rp.observed_at) as first_seen, max(rp.observed_at) as last_seen
            from reports_public rp
           where ${speciesMembers(tx, "rp.taxon_id", id)}
        ) s on true
       where t.id = ${id}`,
  );
  return rows[0] ?? null;
}

/**
 * One taxon, as a record's species card shows it, read afresh.
 *
 * Read once per request however many times it is asked for (React's
 * `cache`): a page and its `generateMetadata` both need it, and each asked
 * the database separately.
 */
export const getSpecies = cache(readSpecies);

/**
 * The scientific name a taxon's address is made of (speciesSlug), or null for
 * an id that names no taxon. Read afresh, one row by its primary key, and
 * once per request (React's `cache`), by the species page before anything
 * cached: an address that is not a taxon's own then costs that one read and
 * a 404, and no entry in the cache every reader shares.
 */
export const speciesAddressName = cache(async (id: number): Promise<string | null> => {
  const rows = await asPublic(
    (tx) => tx<{ name: string }[]>`select scientific_name as name from taxa where id = ${id}`,
  );
  return rows[0]?.name ?? null;
});

/**
 * Whether `column` holds one of the taxa the species `taxonId` speaks for: the
 * taxon, and the subspecies shown on its card (species_card_members, 0040).
 * A null taxonId matches every row.
 *
 * The species page, its map's tiles and the record list all filter through
 * this, so the records a species' page counts are the ones its map draws and
 * its list holds. For a subspecies folded into its species it is the
 * subspecies alone: that page is about the subspecies.
 *
 * `column` is spliced into the SQL, so it is a constant at every call.
 */
export function speciesMembers(
  tx: postgres.TransactionSql,
  column: string,
  taxonId: number | null,
) {
  return tx`(${taxonId}::bigint is null or ${tx.unsafe(column)} in (
    select m.taxon_id from species_card_members m where m.card_id = ${taxonId}))`;
}

/**
 * Whether `param`, the species page's address, is the taxon's own: the slug
 * speciesSlug() makes from its id and its current name, exactly. Anything
 * else is not found, an id with someone else's name after it included.
 */
export async function isSpeciesAddress(param: string, id: number): Promise<boolean> {
  const name = await speciesAddressName(id);
  return name !== null && param === speciesSlug({ id, scientificName: name });
}

/**
 * The same taxon for its species page, which is cached for everybody: from
 * the cache every reader shares, tagged with the reports
 * (lib/siteFigures.ts).
 *
 * Through that cache rather than afresh because the tag is what drops the
 * cached page. The page lists a sparse species' records, each with its point;
 * a record re-identified as a blurred species, or thrown out, must leave the
 * old page when the writer says the reports changed, and a page is dropped
 * with the tags of what it read. This is the read every species page makes,
 * whatever it has on it. `cache` on top, so the page and its metadata still
 * ask once.
 */
export const getCachedSpecies = cache(siteFigure("species", readSpecies));

/**
 * A species a "report this species" link may carry, and the report pages that
 * would accept it.
 *
 * Null for a name no page files under: a retired name, one not found in
 * Taiwan, or one outside every page's scope (a plant, a genus). Prefilled, any
 * of those would be sent as the report's species and the server would not file
 * it as named — or, for one outside the page's scope, would refuse the report,
 * and the offline queue treats a refusal as final. Unfilled, the reporter picks
 * from names that work.
 *
 * Read through asPublic like getSpecies, so a taxon whose coordinates are
 * withheld still reports zero records, and counted as its page counts them
 * (speciesMembers), so the picker says the number the species page does.
 */
export async function reportableSpecies(id: number): Promise<{
  id: number;
  taicolId: string;
  scientificName: string;
  commonNameZh: string | null;
  commonNameEn: string | null;
  isInvasive: boolean;
  reportCount: number;
  pages: ReportPage[];
} | null> {
  const scopes = REPORT_PAGE_KEYS.map(
    (p) => `${inPageScope(REPORT_PAGES[p].species)} as "in_${p}"`,
  ).join(", ");
  const rows = await asPublic(
    (tx) => tx<
      ({
        id: number;
        taicolId: string;
        scientificName: string;
        commonNameZh: string | null;
        commonNameEn: string | null;
        isInvasive: boolean;
        reportCount: number;
        offered: boolean;
      } & Record<`in_${ReportPage}`, boolean>)[]
    >`
      select t.id, t.taicol_id as "taicolId", t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh",
             t.common_name_en as "commonNameEn",
             t.is_invasive as "isInvasive",
             s.report_count as "reportCount",
             ${tx.unsafe(OFFERED)} as offered,
             ${tx.unsafe(scopes)}
        from taxa t
        cross join lateral (
          select count(*)::int as report_count
            from reports_public rp
           where ${speciesMembers(tx, "rp.taxon_id", id)}) s
       where t.id = ${id}`,
  );
  const row = rows[0];
  if (!row?.offered) return null;
  const pages = REPORT_PAGE_KEYS.filter((p) => row[`in_${p}`]);
  if (pages.length === 0) return null;
  return {
    id: row.id,
    taicolId: row.taicolId,
    scientificName: row.scientificName,
    commonNameZh: row.commonNameZh,
    commonNameEn: row.commonNameEn,
    isInvasive: row.isInvasive,
    reportCount: row.reportCount,
    pages,
  };
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
 * Both callers join `species_report_stats` as `s` and `taxa` as `t`, and
 * count or list the cards the matching rows are shown on (CARD), so a card is
 * found by any of its rows: 家燕 by "gutturalis" as well as by its name.
 *
 * Accepted names only. TaiCOL keeps a name it has retired as a row marked
 * `deleted`, often beside the accepted row for the same animal, and this used
 * to offer both: 多線南蜥 Mabuya multifasciata sat in the invasive list next to
 * 多線真稜蜥 Eutropis multifasciata, which is what TaiCOL retired it in favour
 * of, and a reporter could file under either. 1,897 such rows are marked in
 * Taiwan. Records already filed under one keep displaying — a record page
 * reads its taxon by id through getSpecies(), which has no such filter — but
 * nobody is offered one to choose. The rule is OFFERED, which the report form
 * and `POST /api/reports` share.
 */
/**
 * The card a directory row is shown on: its own, or for a subspecies in
 * species_folds its species'. Needs `species_folds` joined as `f`.
 */
const CARD = "coalesce(f.species_id, t.id)";

/** The longest search term any caller accepts (as /api/species/search always did). */
export const MAX_QUERY = 64;

/**
 * A search term as it may reach a query: the first value when a parameter
 * repeats, no control characters (Postgres rejects U+0000 outright, which was
 * a 500), trimmed, and no longer than MAX_QUERY (each extra character is
 * matched against about 68,000 names, several columns each).
 */
export function normaliseQuery(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_QUERY);
  return clean || undefined;
}

function speciesWhere(
  tx: postgres.TransactionSql,
  filter: SpeciesFilter,
  like: string | null,
) {
  return tx`
         ${tx.unsafe(OFFERED)}
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
       -- English, whatever the page's language: a reader on the Chinese page
       -- who knows the animal as "green iguana" should find it too. ILIKE,
       -- because nobody types "Leopard Cat" with its capitals. Both spellings
       -- of "gray/grey" are in alt_names_en, so either finds 蒼鷺.
       or t.common_name_en ilike ${like}
       or exists (
         select 1 from unnest(t.alt_names_en) a where a ilike ${like}
       )
     )`;
}

/**
 * How many cards the same query matches, for the directory's pager: a species
 * and the same-named subspecies on its card count once (CARD).
 *
 * `kingdom` narrows it for a caller that needs a checklist total to set beside
 * the recorded count — /season's "of Taiwan's animal species and subspecies".
 * That figure goes through this function rather than a query of its own so
 * that it counts the same kind of thing as the number above it: the directory
 * counts species and subspecies rows alike, and a denominator of species rows
 * alone divided two different kinds of count. The directory never passes it.
 *
 * `collection` narrows it to taxa with at least one public record in that
 * collection, for the collection pages' "species named" — the same kind of row
 * the directory counts, so a collection's figure can be checked against the
 * directory and against the site's total, and never exceeds the total. The
 * collection is read through selectionFor(), as the map and the list read it.
 */
export async function countSpecies(opts: {
  q?: string;
  filter?: SpeciesFilter;
  kingdom?: string;
  collection?: Collection;
}): Promise<number> {
  const { filter = "recorded", kingdom = null, collection = null } = opts;
  const q = normaliseQuery(opts.q);
  const like = q ? `%${q}%` : null;
  const { categories, invasiveOnly } = selectionFor(
    collection ? { collection } : {},
  );
  const rows = await asPublic(
    (tx) => tx<{ n: number }[]>`
      select count(distinct ${tx.unsafe(CARD)})::int as n
        from taxa t
        left join species_report_stats s on s.taxon_id = t.id
        left join species_folds f on f.taxon_id = t.id
       where ${speciesWhere(tx, filter, like)}
         and (${kingdom}::text is null or t.kingdom = ${kingdom})
         and (${collection}::text is null or exists (
               select 1 from reports_public rp
                where rp.taxon_id = t.id
                  and (${categories}::text[] is null or rp.category = any(${categories}))
                  and (not ${invasiveOnly}::boolean or rp.is_invasive)))`,
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
  /**
   * A report page's species, and nothing outside them (see inPageScope). For
   * the pickers only; the directory and the map search everything.
   */
  scope?: SpeciesScope;
  limit?: number;
  offset?: number;
}): Promise<SpeciesSummary[]> {
  const {
    filter = "recorded",
    preferNative = false,
    scope,
    limit = 60,
    offset = 0,
  } = opts;
  const q = normaliseQuery(opts.q);
  const inScope = scope ? inPageScope(scope) : "true";
  const term = q ?? null;
  const like = q ? `%${q}%` : null;
  const prefix = q ? `${q}%` : null;
  const wordPrefix = q ? `% ${q}%` : null;

  return asPublic(
    (tx) => tx<SpeciesSummary[]>`
      -- The rows that match, each with the card it is shown on and how well it
      -- matched; then one line per card, as well matched as its best row. The
      -- card is listed as its own row, with its records counted over the
      -- rows it covers (species_card_stats).
      with hit as (
        select ${tx.unsafe(CARD)} as card_id,
               -- Relevance first, and it has to be: searching 石虎 returned 豹貓
               -- (its own alternate name) and 前鰭吻鮋 above the species
               -- actually called 石虎, because the only ordering was by record
               -- count. That is tolerable in a directory and useless in a
               -- picker, where the reporter types the name of the animal in
               -- front of them and expects it first.
               case
                 when ${term}::text is null then 3
                 when t.common_name_zh = ${term}
                   or t.scientific_name ilike ${term}
                   -- An exact alternate name counts as exact, not as a lesser
                   -- match. 石虎 is the common name of the subspecies
                   -- euptilurus and an alternate for the species 豹貓. The
                   -- records sat on the species until migration 0022 moved
                   -- them to the subspecies, and ranking the exact common name
                   -- above them sent a reporter to a page with nothing on it.
                   -- Tie broken by records below, which is the only evidence
                   -- we have about which name is used for which taxon.
                   or exists (select 1 from unnest(t.alt_names_zh) a where a = ${term})
                   -- An exact English name or English alternate, in any case.
                   or lower(t.common_name_en) = lower(${term})
                   or exists (select 1 from unnest(t.alt_names_en) a where lower(a) = lower(${term}))
                   then 0
                 when t.common_name_zh like ${prefix} or t.scientific_name ilike ${prefix}
                   -- "leopard" finds Leopard Cat, and "cat" finds it too:
                   -- English names are several words, and people type any one.
                   or t.common_name_en ilike ${prefix}
                   or t.common_name_en ilike ${wordPrefix}
                   then 1
                 else 2
               end as rel,
               (t.common_name_zh is distinct from ${term}) as named_otherwise
          from taxa t
          left join species_report_stats s on s.taxon_id = t.id
          left join species_folds f on f.taxon_id = t.id
         where ${speciesWhere(tx, filter, like)}
           and ${tx.unsafe(inScope)}
      ),
      card as (
        select card_id, min(rel) as rel, bool_and(named_otherwise) as named_otherwise
          from hit
         group by card_id
      )
      select ${tx.unsafe(SUMMARY_COLS)}
        from card c
        join taxa t on t.id = c.card_id
        left join species_card_stats s on s.taxon_id = t.id
       order by
         c.rel,
         (${preferNative}::boolean and t.alien_type is distinct from 'native'),
         (s.report_count is null), s.report_count desc nulls last,
         -- Among equally-exact, equally-recorded matches, the taxon actually
         -- called that comes before one that merely lists it as an alternate:
         -- 石虎 is also an alternate name for 前鰭吻鮋, a scorpionfish.
         c.named_otherwise,
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

/**
 * Where a taxon sits among the cards, for its page: the species a subspecies
 * belongs to, whether the subspecies is shown on that species' card, and for
 * a species, the subspecies shown on its own.
 *
 * Read through asPublic, and only names: nothing here counts a record.
 */
export async function speciesRelations(id: number): Promise<{
  /** The species above a subspecies, when it is a name the site offers. */
  species: SpeciesRef | null;
  /** Whether this subspecies is shown on that species' card (species_folds). */
  onSpeciesCard: boolean;
  /** The subspecies shown on this species' card. */
  folded: SpeciesRef[];
}> {
  // `t` is the row named, as OFFERED expects of `taxa`.
  const REF = `t.id, t.scientific_name as "scientificName",
               t.common_name_zh as "commonNameZh", t.common_name_en as "commonNameEn"`;
  return asPublic(async (tx) => {
    const species = await tx<(SpeciesRef & { onSpeciesCard: boolean })[]>`
      select ${tx.unsafe(REF)},
             exists (select 1 from species_folds f
                      where f.taxon_id = sub.id and f.species_id = t.id) as "onSpeciesCard"
        from taxa sub
        join taxa t on t.taicol_id = sub.species_taicol_id
       where sub.id = ${id} and t.id <> sub.id
         and ${tx.unsafe(OFFERED)}`;
    const folded = await tx<SpeciesRef[]>`
      select ${tx.unsafe(REF)}
        from species_folds f
        join taxa t on t.id = f.taxon_id
       where f.species_id = ${id}
       order by t.scientific_name, t.id`;
    const [sp] = species;
    return {
      species: sp
        ? {
            id: sp.id,
            scientificName: sp.scientificName,
            commonNameZh: sp.commonNameZh,
            commonNameEn: sp.commonNameEn,
          }
        : null,
      onSpeciesCard: sp?.onSpeciesCard ?? false,
      folded,
    };
  });
}

export type SpeciesRef = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  commonNameEn: string | null;
};

/**
 * The name of a taxon a list or a map arrived filtered to.
 *
 * Checked against `reports_public`, not merely read from `taxa`, and that is
 * the privacy rule rather than a convenience: a taxon rated 座標不開放 has no
 * rows in `reports_public`, so naming it above an empty
 * list would be the only thing on the page confirming it had ever been recorded
 * in Taiwan. An unrecorded or withheld id answers null and the page says
 * nothing about it.
 *
 * Recorded means recorded under any row the filter covers (speciesMembers):
 * the map and the list filtered to 埃及聖䴉 draw the subspecies' records, so
 * they are named over them although the species row itself holds none.
 */
export async function publicSpeciesName(id: number): Promise<{
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  commonNameEn: string | null;
} | null> {
  const rows = await asPublic(
    (tx) => tx<
      {
        id: number;
        scientificName: string;
        commonNameZh: string | null;
        commonNameEn: string | null;
      }[]
    >`
      select t.id, t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh",
             t.common_name_en as "commonNameEn"
        from taxa t
       where t.id = ${id}
         and exists (select 1 from reports_public rp
                      where ${speciesMembers(tx, "rp.taxon_id", id)})`,
  );
  return rows[0] ?? null;
}

/**
 * Monthly distribution — roadkill is strongly seasonal, so this is the most
 * scientifically useful chart on the page. Over the rows the page speaks for
 * (speciesMembers), as its count is. Cached for everybody, under the reports'
 * tag, like the figures (lib/siteFigures.ts).
 */
export const monthlyCounts = siteFigure("monthlyCounts", async (taxonId: number): Promise<number[]> => {
  const rows = await asPublic(
    (tx) => tx<{ month: number; n: number }[]>`
      select extract(month from observed_at at time zone 'Asia/Taipei')::int as month, count(*)::int as n
        from reports_public where ${speciesMembers(tx, "taxon_id", taxonId)}
       group by 1 order by 1`,
  );
  const out = Array(12).fill(0);
  for (const r of rows) out[r.month - 1] = r.n;
  return out;
});

export type SpeciesRecord = {
  id: string;
  observedAt: string;
  lat: number;
  lng: number;
  category: string;
  isObscured: boolean;
};

/**
 * A species with this many public records or fewer has them listed, each
 * with its point, rather than charted.
 */
export const LIST_MAX_RECORDS = 5;

/**
 * Individual records, for species too sparse to justify a heatmap.
 *
 * Each with its point, so read afresh, never from the figures' cache: a point
 * may be no older than the page it is on (lib/siteFigures.ts), and a cached
 * copy could be five minutes old before the page was even made. The species
 * page asks for them per request, through GET /api/species/[id]/records, so
 * that no cached page holds one at all. Over speciesMembers, like the count.
 *
 * From `reports_on_map`, not `reports_public`: a record held at 10 km until
 * the model has looked at its photo (migration 0033) may then be blurred
 * harder, and the view leaves it out until it is released, as the map's
 * tiles do. The record's own page still shows it.
 */
export function recentRecords(taxonId: number, limit: number = 12): Promise<SpeciesRecord[]> {
  return asPublic(
    (tx) => tx<SpeciesRecord[]>`
      select id, observed_at as "observedAt",
             st_y(location_public::geometry) as lat,
             st_x(location_public::geometry) as lng,
             category, is_obscured as "isObscured"
        from reports_on_map
       where ${speciesMembers(tx, "taxon_id", taxonId)}
       -- id breaks ties, so the same records are shown on every load.
       order by observed_at desc, id
       limit ${limit}`,
  );
}
