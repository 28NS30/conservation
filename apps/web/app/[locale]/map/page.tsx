import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { asPublic } from "@/lib/db";
import { pageFilter } from "@conservation/shared";
import { overview, recordedSpeciesCount } from "@/lib/stats";
import { speciesMembers } from "@/lib/species";
import HeatmapView from "@/components/map/HeatmapView";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { alternates } from "@/lib/alternates";

// No `revalidate`: the page reads its query string (the view and the filter a
// link carries), so it renders per request whatever one says. The figures in
// its header are cached for everybody instead (lib/siteFigures.ts).

/**
 * "地圖 · 福爾摩沙守望計畫" in the tab. The busiest page on the site was the
 * one page with no title of its own: a tab, a bookmark and a shared link all
 * read as the bare site name, the same as the front page.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  const tm = await getTranslations({ locale, namespace: "map" });
  return { title: t("map"), description: tm("metaDescription"), alternates: alternates(locale, "/map") };
}

type NamedTaxon = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  commonNameEn: string | null;
  taicolId: string | null;
  reportCount: number;
};

/**
 * The taxon a link arrived filtered to, named, for the filter panel.
 *
 * Read as the public role and counted from reports_public, like everything
 * the map shows: a taxon rated 座標不開放 has no rows in reports_public, and
 * naming one above an empty map would be the only thing on the page confirming
 * it had been recorded here. Counted over the rows the tiles draw for it
 * (speciesMembers): a species with the same-named subspecies on its card.
 */
async function namedTaxon(id: number): Promise<NamedTaxon | null> {
  const rows = await asPublic(
    (tx) => tx<NamedTaxon[]>`
      select t.id, t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh",
             t.common_name_en as "commonNameEn",
             t.taicol_id as "taicolId",
             s.report_count as "reportCount"
        from taxa t
        cross join lateral (
          select count(*)::int as report_count
            from reports_public rp
           where ${speciesMembers(tx, "rp.taxon_id", id)}) s
       where t.id = ${id} and s.report_count > 0`,
  );
  return rows[0] ?? null;
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
  // the client — and an old `group=` link is read as the collection it meant,
  // which the map then asks for tiles by and writes back to the address bar.
  const initialFilter = pageFilter(sp);

  // The species count is the directory's, like every other page that states
  // one; see recordedSpeciesCount(). The counts and the years are /stats's
  // (overview()). The taxon a link named is read beside them rather than
  // after: nothing waits on anything else here.
  const taxonId = initialFilter.taxonId;
  const [t, s, species, initialSpecies] = await Promise.all([
    getTranslations(),
    overview(),
    recordedSpeciesCount(),
    taxonId ? namedTaxon(taxonId) : null,
  ]);
  const n = (v: number) => v.toLocaleString(locale);

  return (
    // 100dvh rather than an h-full chain from <html>: it does not depend on every
    // ancestor declaring a height, and it tracks mobile browser chrome collapsing,
    // which matters because reports get filed one-handed at the roadside.
    <main className="flex h-[100dvh] flex-col">
      {/* The page had no heading: the map is a canvas and the header is a
          banner, so a screen reader's "next heading" found nothing. */}
      <h1 className="sr-only">{t("nav.map")}</h1>
      <SiteHeader
        variant="app"
        stats={{
          reports: n(s.reports),
          species: species.toLocaleString(locale),
          range: s.firstYear && s.lastYear ? `${s.firstYear}–${s.lastYear}` : null,
        }}
      />

      {/* `on-dark` scopes the dark colour scheme to the one thing on the site
          that actually is dark. The root used to declare it for every page,
          which painted the report form's checkbox and date picker dark on
          cream; here it is what makes the year <select>s' <option> lists
          legible, since an <option> cannot be styled by us on most platforms. */}
      <div className="on-dark relative min-h-0 flex-1">
        <HeatmapView
          maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
          initialView={view}
          initialFilter={initialFilter}
          initialSpecies={initialSpecies}
          years={s.firstYear && s.lastYear ? { first: s.firstYear, last: s.lastYear } : null}
        />
      </div>

      <SiteFooter variant="app" obscured={s.obscured} />
      <span className="sr-only">{t("site.title")}</span>
    </main>
  );
}
