import { asPublic } from "@/lib/db";

/**
 * Map coverage: how much of Taiwan has any record at all.
 *
 * This exists to give the project a shared target that cannot be farmed. The
 * obvious goal — "report more invasive species" — is a bounty on finds, and
 * bounties on finds have one documented failure mode: the same infestation
 * reported daily, the same photograph resubmitted, and in Taiwan's own 2017
 * green-iguana bounty, animals bred to be handed in. Counting records rewards
 * volume, and volume is the one thing a distribution dataset does not need.
 *
 * Coverage inverts that. The second record in a 5 km cell is worth nothing, so
 * there is no point sitting on a known site; the only way to move the number is
 * to visit somewhere nobody has been. That is also, independently, what the data
 * is short of — 46,000 records concentrated on surveyed roads describe those
 * roads, not Taiwan.
 *
 * OBSCURED RECORDS CANNOT COUNT. A sensitive taxon is published at a 10 km or
 * 50 km cell centre, so crediting it to a 5 km cell would credit the wrong cell —
 * the same reasoning that makes `hotspots()` exclude them, and for the same
 * reason: an artefact of blurring would point at the blurred cell. Those records
 * still count in every other statistic on the site, and the season page says so
 * rather than quietly dropping them.
 */

/** Matches the hotspot grid on /stats, so the two describe the same squares. */
export const COVERAGE_CELL_M = 5000;

/** How many new cells a season asks for. */
export const SEASON_TARGET = Number(
  process.env.NEXT_PUBLIC_SEASON_TARGET ?? 40,
);

export type Coverage = {
  /** Distinct 5 km cells holding at least one published, unobscured record. */
  covered: number;
  /** Cells first reached during this season, by a public contributor. */
  newThisSeason: number;
  /** Records the grid cannot place, because their species is sensitive. */
  unplaceable: number;
  /** Distinct taxa with at least one published record. */
  speciesRecorded: number;
  /** Species on TaiCOL's Taiwan checklist — the denominator. */
  speciesInChecklist: number;
  seasonStart: string;
  seasonEnd: string;
};

/**
 * A season is the calendar quarter, in Taipei time.
 *
 * Deliberately derived rather than configured: a hardcoded end date is a date
 * that passes, and a goal page showing an expired deadline reads as abandoned.
 */
export async function coverage(): Promise<Coverage> {
  const [row] = await asPublic(
    (tx) => tx<Coverage[]>`
      with bounds as (
        select date_trunc('quarter', now() at time zone 'Asia/Taipei') as season_start
      ),
      cells as (
        select floor(st_x(geom_3857) / ${COVERAGE_CELL_M})::int as gx,
               floor(st_y(geom_3857) / ${COVERAGE_CELL_M})::int as gy,
               min(created_at) as first_at,
               count(*) filter (
                 where source = 'user'
                   and created_at >= (select season_start from bounds)
               )::int as fresh
          from reports_public
         where not is_obscured
         group by 1, 2
      )
      select
        (select count(*)::int from cells) as covered,
        (select count(*)::int from cells
          where first_at >= (select season_start from bounds) and fresh > 0)
          as "newThisSeason",
        (select count(*)::int from reports_public where is_obscured) as unplaceable,
        (select count(distinct taxon_id)::int from reports_public
          where taxon_id is not null) as "speciesRecorded",
        (select count(*)::int from taxa where is_in_taiwan and rank = 'Species')
          as "speciesInChecklist",
        (select season_start from bounds)::text as "seasonStart",
        ((select season_start from bounds) + interval '3 months' - interval '1 day')::date::text
          as "seasonEnd"`,
  );
  return row;
}
