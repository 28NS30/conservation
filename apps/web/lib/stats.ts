import { asPublic } from "@/lib/db";
import type { Category } from "@conservation/shared";

/**
 * Aggregates behind /stats.
 *
 * Every query reads `reports_public`, never `reports` — see asPublic(). That is
 * not a style preference: counting from the base table would expose the true
 * record volume and true coordinates of 敏感 taxa, which is precisely what the
 * obscuring design exists to prevent. A hotspot list is a particularly effective
 * way to leak a location, so it gets the extra restriction below.
 */

export type Overview = {
  reports: number;
  species: number;
  obscured: number;
  identified: number;
  firstYear: number | null;
  lastYear: number | null;
};

export async function overview(): Promise<Overview> {
  const [row] = await asPublic(
    (tx) => tx<Overview[]>`
      select count(*)::int                                         as reports,
             count(distinct taxon_id)::int                         as species,
             count(*) filter (where is_obscured)::int              as obscured,
             count(*) filter (where taxon_id is not null)::int     as identified,
             extract(year from min(observed_at))::int              as "firstYear",
             extract(year from max(observed_at))::int              as "lastYear"
        from reports_public`,
  );
  return row;
}

export async function categoryCounts(): Promise<{ category: Category; n: number }[]> {
  return asPublic(
    (tx) => tx<{ category: Category; n: number }[]>`
      select category, count(*)::int as n
        from reports_public group by 1 order by n desc`,
  );
}

/** Twelve buckets, Jan–Dec, zero-filled. Roadkill is strongly seasonal. */
export async function monthlyTotals(): Promise<number[]> {
  const rows = await asPublic(
    (tx) => tx<{ m: number; n: number }[]>`
      select extract(month from observed_at)::int as m, count(*)::int as n
        from reports_public group by 1 order by 1`,
  );
  const out = Array<number>(12).fill(0);
  for (const r of rows) out[r.m - 1] = r.n;
  return out;
}

export async function yearlyTotals(): Promise<{ year: number; n: number }[]> {
  return asPublic(
    (tx) => tx<{ year: number; n: number }[]>`
      select extract(year from observed_at)::int as year, count(*)::int as n
        from reports_public group by 1 order by 1`,
  );
}

export type TopSpecies = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  reportCount: number;
  protectedStatus: string | null;
  isInvasive: boolean;
  isEndemic: boolean;
};

export async function topSpecies(limit = 15): Promise<TopSpecies[]> {
  return asPublic(
    (tx) => tx<TopSpecies[]>`
      select t.id, t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh", s.report_count as "reportCount",
             t.protected_status as "protectedStatus",
             t.is_invasive as "isInvasive", t.is_endemic as "isEndemic"
        from species_report_stats s
        join taxa t on t.id = s.taxon_id
       order by s.report_count desc, t.scientific_name
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
 */
export async function hotspots(limit = 8): Promise<Hotspot[]> {
  return asPublic(
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
          from cells group by 1, 2 order by n desc limit ${limit}
      ),
      dominant as (
        select distinct on (c.gx, c.gy) c.gx, c.gy, c.taxon_id
          from cells c
          join totals t on t.gx = c.gx and t.gy = c.gy
         where c.taxon_id is not null
         order by c.gx, c.gy, c.n desc
      )
      select t.n,
             d.taxon_id as "taxonId",
             tx_.common_name_zh as "topSpeciesZh",
             tx_.scientific_name as "topSpeciesSci",
             st_x(st_transform(st_setsrid(st_makepoint(
               (t.gx + 0.5) * ${HOTSPOT_CELL_M}, (t.gy + 0.5) * ${HOTSPOT_CELL_M}), 3857), 4326)) as lng,
             st_y(st_transform(st_setsrid(st_makepoint(
               (t.gx + 0.5) * ${HOTSPOT_CELL_M}, (t.gy + 0.5) * ${HOTSPOT_CELL_M}), 3857), 4326)) as lat
        from totals t
        left join dominant d on d.gx = t.gx and d.gy = t.gy
        left join taxa tx_ on tx_.id = d.taxon_id
       order by t.n desc`,
  );
}
