import { getTranslations, setRequestLocale } from "next-intl/server";
import { asPublic, sql } from "@/lib/db";
import { mapFilterSchema } from "@conservation/shared";
import HeatmapView from "@/components/map/HeatmapView";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

// Stats are cheap but not worth recomputing per request.
export const revalidate = 300;

type Stats = {
  reports: string;
  species: string;
  obscured: string;
  earliest: string | null;
  latest: string | null;
};

type NamedTaxon = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  reportCount: number;
};

/**
 * The taxon a link arrived filtered to, named, for the filter panel.
 *
 * Read as the public role and joined to species_report_stats, like everything
 * the map shows: a taxon rated 座標不開放 has no rows in reports_public, and
 * naming one above an empty map would be the only thing on the page confirming
 * it had been recorded here.
 */
async function namedTaxon(id: number): Promise<NamedTaxon | null> {
  const rows = await asPublic(
    (tx) => tx<NamedTaxon[]>`
      select t.id, t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh",
             s.report_count as "reportCount"
        from taxa t
        join species_report_stats s on s.taxon_id = t.id
       where t.id = ${id}`,
  );
  return rows[0] ?? null;
}

async function getStats(): Promise<Stats> {
  const [row] = await sql<Stats[]>`
    select count(*)::text                                            as reports,
           count(distinct taxon_id)::text                            as species,
           count(*) filter (where is_obscured)::text                 as obscured,
           to_char(min(observed_at), 'YYYY')                         as earliest,
           to_char(max(observed_at), 'YYYY')                         as latest
      from reports_public`;
  return row;
}

/**
 * Deep-link target: `/map?lng=120.4&lat=22.7&z=11`.
 *
 * Parsed here rather than in the client component so a bad or hostile query
 * string can never reach MapLibre — an out-of-range latitude throws inside
 * `jumpTo` and takes the whole map down with it.
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

export default async function MapPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const view = parseView(sp as { lng?: string; lat?: string; z?: string });
  // Filters travel in the URL too, so a shared link carries what the sender was
  // actually looking at rather than just where. Parsed with the same schema the
  // tile endpoint uses, so a malformed filter is dropped rather than handed to
  // the client.
  const parsedFilter = mapFilterSchema.safeParse(sp);
  const initialFilter = parsedFilter.success ? parsedFilter.data : {};

  const t = await getTranslations();
  const s = await getStats();
  const taxonId = initialFilter.taxonId;
  const initialSpecies = taxonId ? await namedTaxon(taxonId) : null;
  const n = (v: string) => Number(v).toLocaleString(locale);

  return (
    // 100dvh rather than an h-full chain from <html>: it does not depend on every
    // ancestor declaring a height, and it tracks mobile browser chrome collapsing,
    // which matters because reports get filed one-handed at the roadside.
    <main className="flex h-[100dvh] flex-col">
      <SiteHeader
        variant="app"
        stats={{
          reports: n(s.reports),
          species: n(s.species),
          range: s.earliest && s.latest ? `${s.earliest}–${s.latest}` : null,
        }}
      />

      <div className="relative min-h-0 flex-1">
        <HeatmapView
          maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
          initialView={view}
          initialFilter={initialFilter}
          initialSpecies={initialSpecies}
          years={
            s.earliest && s.latest
              ? { first: Number(s.earliest), last: Number(s.latest) }
              : null
          }
        />
      </div>

      <SiteFooter
        variant="app"
        obscured={Number(s.obscured) > 0 ? n(s.obscured) : undefined}
      />
      <span className="sr-only">{t("site.title")}</span>
    </main>
  );
}
