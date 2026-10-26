import { asPublic } from "@/lib/db";
import { countSpecies } from "@/lib/species";
import { freshPoints, siteFigure } from "@/lib/siteFigures";
import { everyYear } from "@/lib/yearSeries";

/**
 * Aggregates behind /stats.
 *
 * Every query reads `reports_public`, never `reports` — see asPublic(). That is
 * not a style preference: counting from the base table would expose the true
 * record volume and true coordinates of 敏感 taxa, which is precisely what the
 * obscuring design exists to prevent. A hotspot list is a particularly effective
 * way to leak a location, so it gets the extra restriction below.
 *
 * The site-wide figures are cached for everybody (lib/siteFigures.ts): the
 * same for every reader, full passes over the view, and changed only by a
 * new or re-identified record. Not the two that place records, the
 * anniversary ledger and the hotspots: a point may be no older than the page
 * it is on, so they are read afresh each time a page is built from them.
 */

/**
 * How many species have a record here: the one number every page states.
 *
 * It is the species directory's own count, and deliberately not a second query
 * that looks like it. Two definitions were in use and they disagreed in public:
 * /stats, /season and the map's header counted `distinct taxon_id` over the
 * public view and said 506 in production, while the directory — the page a
 * reader opens to check — listed 501. The five in between hold records filed
 * under names that do not apply in Taiwan (Dopasia harti is a Fujian lizard),
 * which the directory hides while they wait to be moved to the right species.
 * A statistic that counts a species the reader cannot find is one the reader
 * cannot trust.
 *
 * So the definition lives in exactly one place, `speciesWhere()` in
 * lib/species.ts, and this is how everything else asks it. Subspecies count as
 * their own rows there, as they do in the directory's list.
 */
export const recordedSpeciesCount = siteFigure(
  "recordedSpeciesCount",
  (): Promise<number> => countSpecies({ filter: "recorded" }),
);

/**
 * The denominator /season sets beside recordedSpeciesCount(): every animal
 * taxon on Taiwan's checklist, counted by the same `speciesWhere()`.
 *
 * It was `rank = 'Species'` alone, under a numerator that counts species and
 * subspecies rows alike, so "500 of 42,061" divided 328 species plus 172
 * subspecies by species only. Counting subspecies on both sides keeps the
 * numerator the one number every other page states, and makes the ratio like
 * over like. Collapsing subspecies into their species instead would have given
 * /season a species count of its own (477 locally) beside /stats's 500, which
 * is the disagreement recordedSpeciesCount() exists to end.
 *
 * Animals, because only animals are reported here. The whole checklist —
 * plants, fungi and bacteria included — made the site look 0.8% done at
 * recording things it never set out to record.
 */
export const checklistAnimalTaxaCount = siteFigure(
  "checklistAnimalTaxaCount",
  (): Promise<number> => countSpecies({ filter: "all", kingdom: "Animalia" }),
);

export type Overview = {
  reports: number;
  obscured: number;
  identified: number;
  firstYear: number | null;
  lastYear: number | null;
};

/**
 * The size and span of the public record. One pass, and the one source for
 * every page that states these: /stats, the map's header and footer, the
 * home page's blurred-record count and the list's lede, which each asked
 * the same question of the same view with a query of their own.
 */
export const overview = siteFigure("overview", async (): Promise<Overview> => {
  const [row] = await asPublic(
    (tx) => tx<Overview[]>`
      select count(*)::int                                         as reports,
             count(*) filter (where is_obscured)::int              as obscured,
             count(*) filter (where taxon_id is not null)::int     as identified,
             extract(year from min(observed_at) at time zone 'Asia/Taipei')::int              as "firstYear",
             extract(year from max(observed_at) at time zone 'Asia/Taipei')::int              as "lastYear"
        from reports_public`,
  );
  return row;
});

/** Twelve buckets, Jan–Dec, zero-filled. Roadkill is strongly seasonal. */
export const monthlyTotals = siteFigure("monthlyTotals", async (): Promise<number[]> => {
  const rows = await asPublic(
    (tx) => tx<{ m: number; n: number }[]>`
      select extract(month from observed_at at time zone 'Asia/Taipei')::int as m, count(*)::int as n
        from reports_public group by 1 order by 1`,
  );
  const out = Array<number>(12).fill(0);
  for (const r of rows) out[r.m - 1] = r.n;
  return out;
});

/** Every year from the first record's to the last's, zero-filled (lib/yearSeries.ts). */
export const yearlyTotals = siteFigure(
  "yearlyTotals",
  async (): Promise<{ year: number; n: number }[]> => {
    const rows = await asPublic(
      (tx) => tx<{ year: number; n: number }[]>`
      select extract(year from observed_at at time zone 'Asia/Taipei')::int as year, count(*)::int as n
        from reports_public group by 1 order by 1`,
    );
    return everyYear(rows);
  },
);

export type TopSpecies = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  commonNameEn: string | null;
  taicolId: string;
  reportCount: number;
  protectedStatus: string | null;
  isInvasive: boolean;
  isEndemic: boolean;
};

export const topSpecies = siteFigure("topSpecies", (limit: number = 15): Promise<TopSpecies[]> =>
  asPublic(
    (tx) => tx<TopSpecies[]>`
      select t.id, t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh", s.report_count as "reportCount",
             t.common_name_en as "commonNameEn", t.taicol_id as "taicolId",
             t.protected_status as "protectedStatus",
             t.is_invasive as "isInvasive", t.is_endemic as "isEndemic"
        from species_report_stats s
        join taxa t on t.id = s.taxon_id
       order by s.report_count desc, t.scientific_name
       limit ${limit}`,
  ),
);

export type EntrySpecies = {
  id: number;
  scientificName: string;
  commonNameZh: string;
  commonNameEn: string | null;
};

/**
 * Animals to offer as a way into the map, from the homepage.
 *
 * The most-recorded species, which are also the ones a stranger has most likely
 * seen. Restricted to species with no sensitivity rating: each becomes a link
 * to that species' records on the map, and a front-page button that leads
 * straight to where a sensitive animal is found would be a strange thing to
 * build, blurred or not. Chinese name required, because the button is the name.
 */
export const mapEntrySpecies = siteFigure("mapEntrySpecies", (limit: number = 3): Promise<EntrySpecies[]> =>
  asPublic(
    (tx) => tx<EntrySpecies[]>`
      select t.id, t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh",
             t.common_name_en as "commonNameEn"
        from species_report_stats s
        join taxa t on t.id = s.taxon_id
       where t.sensitivity is null
         and t.protected_status is null
         and t.common_name_zh is not null
       order by s.report_count desc, t.scientific_name
       limit ${limit}`,
  ),
);

export type MonthSpecies = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  commonNameEn: string | null;
  taicolId: string | null;
  n: number;
};

/**
 * The species found dead on the roads most often in one calendar month,
 * across every year of records, for the home page: the one part of it that
 * changes from month to month. On today's data that is TaiRON's 2011–2017.
 *
 * Exact records only. A protected or sensitive species' records are all
 * blurred, so it never appears here, and the front page does not point at
 * where one is found any more than its map shortcuts do. A record nobody named
 * has no species to count. The month is Taiwan's, passed in by the page.
 */
export const monthRoadkill = siteFigure("monthRoadkill", (month: number, limit: number = 5): Promise<MonthSpecies[]> =>
  asPublic(
    (tx) => tx<MonthSpecies[]>`
      select t.id, t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh", t.common_name_en as "commonNameEn",
             t.taicol_id as "taicolId", count(*)::int as n
        from reports_public rp
        join taxa t on t.id = rp.taxon_id
       where rp.category = 'roadkill'
         and rp.location_precision = 'exact'
         and extract(month from rp.observed_at at time zone 'Asia/Taipei') = ${month}
         and t.common_name_zh is not null
       group by t.id
       -- t.id settles ties, so the list is the same on every load.
       order by n desc, t.id
       limit ${limit}`,
  ),
);

export type LedgerRow = {
  id: string;
  observedAt: string;
  lat: number;
  lng: number;
  commonNameZh: string | null;
  scientificName: string | null;
};

/**
 * A handful of real records from this week, in other years.
 *
 * The front page shows the corpus as a ledger, so what the rows contain is the
 * design. The obvious query — the most recent records — is useless here: the
 * import ends on 2017-12-31 and `order by observed_at desc limit 24` returns
 * twenty-four rows all bearing that one date, so the date column, which is the
 * whole texture, becomes one string repeated twenty-four times.
 *
 * So: records from within three days of today's calendar date, in any year,
 * one per distinct date. The column reads as real descending dates, the species
 * vary, and the page differs every day of the year. The thinnest day in the
 * calendar still has 151 records to draw from.
 *
 * Obscured records are excluded, and not only for tidiness: the row's texture is
 * a precise coordinate, and a blurred one has none to show.
 *
 * It was also, for a while, the thing keeping fourteen 狼 (Canis lupus) off the
 * front page of a site about an island with no wild wolves. TaiRON had not
 * misidentified anything. It published those records as "Canis lupus familiaris"
 * — dogs — and our own import matched GBIF's collapsed `species` against TaiCOL's
 * accepted names, landed on the bare species, and filed them under the wolf,
 * which is protected and therefore blurred. scripts/remap-gbif-taxa.ts moves them
 * to 犬 (Canis familiaris), where TaiRON always had them; once it has run against
 * a database they are unremarkable exact records there, and the ledger may show
 * them.
 *
 * Its rows are records with their points, on a cached page, so it is read
 * afresh each time the page is built, never from the figures' cache
 * (freshPoints, lib/siteFigures.ts): an exact record blurred in the database
 * leaves the ledger with the page that showed it, ten minutes at most, where
 * a cached copy could keep it for fifteen. The page drops it at once when a
 * writer says the reports changed, through the tagged figures it also reads.
 * The window is drawn around Taipei's date, which is passed in rather than
 * read from now(): the same for everybody all day.
 */
export function anniversaryLedger(limit = 12): Promise<LedgerRow[]> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  return freshPoints("anniversaryLedger", () => ledgerAround(today, limit));
}

function ledgerAround(day: string, limit: number): Promise<LedgerRow[]> {
  return asPublic(
    (tx) => tx<LedgerRow[]>`
      with near as (
        select r.id::text,
               r.observed_at as "observedAt",
               st_y(r.location_public::geometry) as lat,
               st_x(r.location_public::geometry) as lng,
               t.common_name_zh as "commonNameZh",
               t.scientific_name as "scientificName",
               row_number() over (
                 partition by (r.observed_at at time zone 'Asia/Taipei')::date
                 order by (t.common_name_zh is null), (t.is_in_taiwan is not true), r.id
               ) as rn
          from reports_public r
          join taxa t on t.id = r.taxon_id
         where not r.is_obscured
           -- The same seven calendar dates as this week, in any year. Day
           -- numbers were wrong twice over: a straight difference put 30
           -- December and 1 January 363 days apart, so the ledger lost every
           -- record across New Year for a week each year; and a leap year
           -- shifts every day number after 28 February by one, so the window
           -- was off by a day for ten months of it. Month-and-day strings have
           -- neither problem.
           and to_char(r.observed_at at time zone 'Asia/Taipei', 'MM-DD') in (
                 select to_char(d, 'MM-DD')
                   from generate_series(
                          ${day}::date - 3,
                          ${day}::date + 3,
                          interval '1 day') d
               )
      )
      select id, "observedAt", lat, lng, "commonNameZh", "scientificName"
        from near where rn = 1
       -- id breaks ties between records of the same day.
       order by "observedAt" desc, id
       limit ${limit}`,
  );
}

export type Hotspot = {
  lng: number;
  lat: number;
  n: number;
  taxonId: number | null;
  topSpeciesZh: string | null;
  topSpeciesSci: string | null;
  topSpeciesEn: string | null;
  topSpeciesTaicolId: string | null;
};

/** Grid cell size for hotspots, in Web Mercator metres. */
const HOTSPOT_CELL_M = 5000;

/**
 * Densest 5km cells, each with the species that dominates it.
 *
 * Obscured records are excluded, and that exclusion is load-bearing rather than
 * cosmetic. An obscured record is snapped to the centre of its 10km or 50km
 * privacy cell, so including them would pile many reports onto one coordinate and
 * manufacture a hotspot that is an artefact of blurring — and worse, that
 * artefact would point straight at the cell containing a sensitive species.
 *
 * Grouping is on integer cell indices rather than a snapped geometry so the
 * aggregation never depends on PostGIS geometry equality.
 *
 * Each hotspot places the records in it to 5 km, and an exact record blurred
 * in the database must leave its cell with the page that counted it. So it
 * is read afresh each time /stats is built, not from the figures' cache
 * (freshPoints, lib/siteFigures.ts): a full pass over the view, at most once
 * in five minutes, since the page is cached and rebuilt no more often.
 */
export function hotspots(limit: number = 8): Promise<Hotspot[]> {
  return freshPoints("hotspots", () => asPublic(
    (tx) => tx<Hotspot[]>`
      with cells as (
        select floor(st_x(geom_3857) / ${HOTSPOT_CELL_M})::int as gx,
               floor(st_y(geom_3857) / ${HOTSPOT_CELL_M})::int as gy,
               taxon_id,
               count(*)::int as n
          from reports_public
         where not is_obscured
         group by 1, 2, 3
      ),
      totals as (
        select gx, gy, sum(n)::int as n
          -- The cell breaks ties at the cut, so equal cells do not trade
          -- places between loads.
          from cells group by 1, 2 order by n desc, gx, gy limit ${limit}
      ),
      dominant as (
        select distinct on (c.gx, c.gy) c.gx, c.gy, c.taxon_id
          from cells c
          join totals t on t.gx = c.gx and t.gy = c.gy
         where c.taxon_id is not null
         -- taxon_id settles a tie for the most-recorded animal in a cell.
         order by c.gx, c.gy, c.n desc, c.taxon_id
      )
      select t.n,
             d.taxon_id as "taxonId",
             tx_.common_name_zh as "topSpeciesZh",
             tx_.scientific_name as "topSpeciesSci",
             tx_.common_name_en as "topSpeciesEn",
             tx_.taicol_id as "topSpeciesTaicolId",
             st_x(st_transform(st_setsrid(st_makepoint(
               (t.gx + 0.5) * ${HOTSPOT_CELL_M}, (t.gy + 0.5) * ${HOTSPOT_CELL_M}), 3857), 4326)) as lng,
             st_y(st_transform(st_setsrid(st_makepoint(
               (t.gx + 0.5) * ${HOTSPOT_CELL_M}, (t.gy + 0.5) * ${HOTSPOT_CELL_M}), 3857), 4326)) as lat
        from totals t
        left join dominant d on d.gx = t.gx and d.gy = t.gy
        left join taxa tx_ on tx_.id = d.taxon_id
       order by t.n desc`,
  ));
}
