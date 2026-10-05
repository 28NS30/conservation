import { unstable_cache } from "next/cache";
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

/**
 * Whether the season goal has anything to count yet: one public record that a
 * person filed here, rather than one imported from TaiRON.
 *
 * Until then /season can only say "0 of 40" beside a deadline, and a goal
 * nobody is moving reads as abandoned. The roadmap's question 20 settled it:
 * hide the goal until reports come in. So the footer and the sitemap leave it
 * out, and the page itself asks not to be indexed. The page stays reachable,
 * because a link to it shared earlier should not break.
 *
 * Cached, because the footer is on every page and this is a scan of the public
 * records when the answer is no. The first public report opens it within the
 * cache window. A database error answers "closed": a missing footer link costs
 * nothing, and a footer that throws takes the page down with it.
 */
export const seasonOpen = unstable_cache(
  async (): Promise<boolean> => {
    try {
      const [row] = await asPublic(
        (tx) => tx<{ open: boolean }[]>`
          select exists (select 1 from reports_public where source = 'user') as open`,
      );
      return Boolean(row?.open);
    } catch (e) {
      console.error("[season] could not tell whether the goal is open:", (e as Error).message);
      return false;
    }
  },
  ["season-open"],
  { revalidate: 900 },
);

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
  /**
   * Records the grid cannot place, because their location is published
   * blurred: a protected or sensitive species, or no species at all.
   */
  unplaceable: number;
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
        -- Midnight in Taipei on the quarter's first day, as an instant. The
        -- inner "at time zone" gives Taipei's wall clock for date_trunc to cut
        -- to the quarter, and the outer one turns that wall-clock time back
        -- into an instant. Without the outer one the comparisons below read
        -- it in the session's zone, UTC in production, eight hours late: for
        -- the first eight hours of every quarter no report counted, and those
        -- reports never counted in any season afterwards (CI failed on it at
        -- 00:02 Taipei time on 1 October 2026).
        select date_trunc('quarter', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei'
                 as season_start
      ),
      cells as (
        select floor(st_x(geom_3857) / ${COVERAGE_CELL_M})::int as gx,
               floor(st_y(geom_3857) / ${COVERAGE_CELL_M})::int as gy,
               -- When the cell was first REACHED, which is not when its first row
               -- was written. The TaiRON corpus was bulk-imported on 2026-08-04,
               -- so every one of the 1,366 covered cells has a created_at inside
               -- the current quarter and would count as newly reached. Only the
               -- fresh-report conjunct was holding the number at zero, and the
               -- first user report to land on an already-mapped square would
               -- have been announced as reaching "a square that had no record at
               -- all until someone went there" — of a square recorded since 2011.
               -- An import is a backfill, not an arrival: for those rows the
               -- honest date is when the animal was seen.
               min(case when source = 'gbif' then observed_at else created_at end)
                 as first_at,
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
        -- The two dates are Taipei's calendar, whatever the session's zone.
        ((select season_start from bounds) at time zone 'Asia/Taipei')::text as "seasonStart",
        (((select season_start from bounds) at time zone 'Asia/Taipei')
           + interval '3 months' - interval '1 day')::date::text
          as "seasonEnd"`,
  );
  return row;
}
