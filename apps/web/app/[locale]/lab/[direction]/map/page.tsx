import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { mapFilterSchema } from "@conservation/shared";
import { asPublic } from "@/lib/db";
import LabHeader from "@/components/lab/chrome/LabHeader";
import LabTabBar from "@/components/lab/chrome/LabTabBar";
import LabMap from "@/components/lab/map/LabMap";
import type { SpeciesHit } from "@/components/lab/map/LabMapControls";
import { getLabCopy } from "@/lib/lab/copy";
import { LAB_ROUTES, isLabDirection, labPath } from "@/lib/lab/directions";

// The year range is cheap but not worth recomputing per request, exactly as on
// the live map.
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // No `robots` here: metadata merges shallowly and the last segment to define
  // a field wins, so the lab layout's noindex would be thrown away.
  return { title: getLabCopy(locale).lab.pageMap };
}

/**
 * The years the public records span, for the year filter.
 *
 * `asPublic` and `reports_public`, never `reports`. The live map reads the same
 * view on the privileged connection; going through the least-privilege role
 * costs nothing here and means this page cannot be the one that learns to read
 * a true coordinate.
 */
async function getYears(): Promise<{ first: number; last: number } | null> {
  const [row] = await asPublic(
    (tx) => tx<{ first: string | null; last: string | null }[]>`
      select to_char(min(observed_at), 'YYYY') as first,
             to_char(max(observed_at), 'YYYY') as last
        from reports_public`,
  );
  return row?.first && row?.last
    ? { first: Number(row.first), last: Number(row.last) }
    : null;
}

/**
 * The taxon a link arrived filtered to, named.
 *
 * Joined to `species_report_stats` like everything else the map shows: a taxon
 * rated 座標不開放 has no rows in `reports_public`, and naming one above an
 * empty map would be the only thing on the page confirming it has been
 * recorded here.
 */
async function namedTaxon(id: number): Promise<SpeciesHit | null> {
  const rows = await asPublic(
    (tx) => tx<SpeciesHit[]>`
      select t.id, t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh",
             s.report_count as "reportCount"
        from taxa t
        join species_report_stats s on s.taxon_id = t.id
       where t.id = ${id}`,
  );
  return rows[0] ?? null;
}

/**
 * Deep-link target: `/lab/roundel/map?lng=120.4&lat=22.7&z=11`.
 *
 * Parsed on the server so a hostile query string can never reach MapLibre: an
 * out-of-range latitude throws inside `jumpTo` and takes the whole map down.
 */
function parseView(q: { lng?: string; lat?: string; z?: string }) {
  const lng = Number(q.lng);
  const lat = Number(q.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -85 || lat > 85) return null;
  const z = Number(q.z);
  return {
    center: [lng, lat] as [number, number],
    zoom: Number.isFinite(z) ? Math.min(Math.max(z, 0), 16) : 11,
  };
}

/**
 * The map, redesigned: direction.md §4, "Map".
 *
 * The hard part is not the look. This page has to be unrecognisable beside
 * today's `/map` and cost exactly the same to open — same style URL, same
 * `/api/tiles` endpoints, no web font, no new kind of request — because the map
 * is the one page of this site whose performance is a feature. So the whole
 * redesign happens in the style JSON before the first frame and in the paint
 * expressions, and nothing is added to the load path.
 *
 * Only Roundel builds this. `LAB_ROUTES` says so, and a `/lab/journal/map` that
 * rendered anyway would be a map with no type marks and a basemap scheme nobody
 * has looked at — a 404 is the honest answer to a page that does not exist.
 */
export default async function LabMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; direction: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, direction } = await params;
  setRequestLocale(locale);
  if (!isLabDirection(direction)) notFound();
  const route = LAB_ROUTES.find((r) => r.sub === "/map");
  if (!route || !(route.directions as readonly string[]).includes(direction))
    notFound();

  const sp = await searchParams;
  const view = parseView(sp as { lng?: string; lat?: string; z?: string });
  // Filters travel in the URL, parsed with the same schema the tile endpoint
  // uses, so a malformed filter is dropped rather than handed to the client.
  const parsed = mapFilterSchema.safeParse(sp);
  const initialFilter = parsed.success ? parsed.data : {};

  const nav = await getTranslations("nav");
  const [years, initialSpecies] = await Promise.all([
    getYears(),
    initialFilter.taxonId ? namedTaxon(initialFilter.taxonId) : null,
  ]);

  return (
    // A flex item of the direction layout's column, so the map fills whatever
    // the lab's own strip and the header leave behind rather than assuming a
    // viewport height that the strip has already spent some of.
    <main className="lab-page-bottom flex min-h-0 flex-1 flex-col">
      <LabHeader direction={direction} variant="map" current="map" />
      {/* The only page in the lab with nothing on it that could be an h1: the
          map IS the content, and direction.md §4 deletes the header stats that
          were standing in for a title. Heard, not seen — and it names the page
          in the live catalogue's own word, so a prototype is not inventing
          vocabulary for the one heading a screen reader lands on first. */}
      <h1 className="sr-only">{nav("map")}</h1>
      <div className="relative min-h-0 flex-1">
        <LabMap
          maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
          years={years}
          initialView={view}
          initialFilter={initialFilter}
          initialSpecies={initialSpecies}
          mapHref={labPath(direction, "/map")}
          copy={getLabCopy(locale)}
        />
      </div>
      <LabTabBar direction={direction} current="map" />
    </main>
  );
}
