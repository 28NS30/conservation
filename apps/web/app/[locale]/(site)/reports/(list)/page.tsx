import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader from "@/components/site/PageHeader";
import { Link } from "@/i18n/navigation";
import { asPublic } from "@/lib/db";
import {
  CATEGORIES,
  REPORT_GROUP_KEYS,
  categoriesIn,
  filterToQuery,
  mapFilterSchema,
  type Category,
  type LocationPrecision,
} from "@conservation/shared";
import { speciesSlug } from "@/lib/species";
import { signedPhotoUrls } from "@/lib/supabase/service";
import { sql } from "@/lib/db";

export const revalidate = 120;

const PAGE_SIZE = 50;

type Row = {
  id: string;
  category: Category;
  observedAt: string;
  lat: number;
  lng: number;
  locationPrecision: LocationPrecision;
  isObscured: boolean;
  taxonId: number | null;
  scientificName: string | null;
  commonNameZh: string | null;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "list" });
  return { title: t("title") };
}

/**
 * Text alternative to the map.
 *
 * A WebGL canvas is unusable with a screen reader, so the same data needs a
 * non-map representation. This is also simply useful — it is the fastest way to
 * see what was reported recently, and it works with no JavaScript at all.
 */
export default async function ReportsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const rawPage = typeof sp.page === "string" ? sp.page : undefined;
  // Parsed with the same schema the map and the tile endpoint use, so the whole
  // filter survives the jump from the map. This page is the accessibility
  // fallback for a canvas nobody can read with a screen reader; if it silently
  // dropped the species and date filters it would not actually be an equivalent.
  const parsed = mapFilterSchema.safeParse(sp);
  const f = parsed.success ? parsed.data : {};
  const taxonId = f.taxonId ?? null;
  const from = f.from ?? null;
  const to = f.to ?? null;

  const t = await getTranslations("list");
  const tc = await getTranslations("categories");
  // The chips are the form's three choices, so they take the form's own words.
  const tr = await getTranslations("report");
  const tp = await getTranslations("precision");

  // The filter jumps here from the map, so it has to be the same three buckets
  // the map offers — this page is that map's accessible equivalent, and an
  // equivalent that filtered differently would not be one.
  const group = f.group ?? null;
  const categories = group ? [...categoriesIn(group)] : null;
  const page = Math.max(1, Number(rawPage) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const rows = await asPublic(
    (tx) => tx<Row[]>`
      select rp.id, rp.category, rp.observed_at as "observedAt",
             st_y(rp.location_public::geometry) as lat,
             st_x(rp.location_public::geometry) as lng,
             rp.location_precision as "locationPrecision",
             rp.is_obscured as "isObscured",
             rp.taxon_id as "taxonId",
             t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh"
        from reports_public rp
        left join taxa t on t.id = rp.taxon_id
       where (${categories}::text[] is null or rp.category = any(${categories}))
         and (${taxonId}::bigint is null or rp.taxon_id = ${taxonId})
         and (${from}::date is null or rp.observed_at >= ${from}::date)
         and (${to}::date   is null or rp.observed_at <  (${to}::date + 1))
       order by rp.observed_at desc
       limit ${PAGE_SIZE + 1} offset ${offset}`,
  );

  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  /*
   * One thumbnail per row.
   *
   * Every row here is someone who stopped at a roadside and photographed a dead
   * animal. As a table of dates and coordinates that reads as a database export;
   * with the photographs it reads as evidence, which is what it is — and this is
   * the page most likely to convince a stranger the project is real.
   *
   * Safe to read paths with the privileged connection: `visible` came from
   * reports_public, so every row here is already publicly visible, and the
   * photos carry no location — EXIF is stripped in the browser before upload.
   */
  const firstPhotos = visible.length
    ? await sql<{ report_id: string; storage_path: string }[]>`
        select distinct on (report_id) report_id::text, storage_path
          from report_photos
         where report_id = any(${visible.map((r) => r.id)}::uuid[])
         order by report_id, created_at`
    : [];
  const signed = await signedPhotoUrls(
    firstPhotos.map((p) => p.storage_path),
    900,
  );
  const thumb = new Map(
    firstPhotos
      .map((p) => [p.report_id, signed.get(p.storage_path)] as const)
      .filter((e): e is readonly [string, string] => !!e[1]),
  );

  /*
   * The column only exists when something is in it.
   *
   * Every seeded record came from GBIF without a photograph — today that is all
   * 46,402 of them — so an unconditional thumbnail column would be a strip of
   * empty placeholders down the whole page, which is worse than the table it
   * replaced. It appears once people start submitting, and until then this page
   * looks exactly as it did.
   *
   * Rows without a photo leave the cell empty rather than drawing a grey square.
   * Once one report has a photograph the column exists for all of them, and
   * 46,402 seeded records have none — a placeholder each would be the same wall
   * of noise by another route.
   */
  const showPhotos = thumb.size > 0;
  const zhFirst = locale.startsWith("zh");

  /** Carry every active filter through paging and the type chips. */
  const activeFilter = filterToQuery({
    ...(group ? { group } : {}),
    ...(taxonId ? { taxonId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const withFilter = (extra: Record<string, string>) => {
    const p = new URLSearchParams(activeFilter);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/reports?${p}`;
  };
  const qs = (p: number) => withFilter({ page: String(p) });
  /**
   * Back to the map, carrying the filter and nothing else.
   *
   * Not `page`: a page number is a fact about a 50-row table and means nothing
   * to a map, and carrying it would produce links that differ without differing.
   * The map answers the same question this page does, and until now the trip was
   * one way — the map offers the list, the list offered no way back, so
   * switching cost a visitor their filters.
   */
  const mapHref = activeFilter ? `/map?${activeFilter}` : "/map";

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pb-24 pt-12">
      <PageHeader title={t("title")} lede={t("subtitle")} />

      <nav
        aria-label={t("filterByCategory")}
        className="mt-4 flex flex-wrap gap-1.5"
      >
        <Link
          href={
            withFilter({})
              .replace(/([?&])group=[^&]*&?/, "$1")
              .replace(/[?&]$/, "") || "/reports"
          }
          aria-current={!group ? "page" : undefined}
          className={`rounded-full border px-3 py-1.5 text-xs transition ${
            !group
              ? "border-ink-900 bg-ink-900 font-medium text-paper-50"
              : "border-ink-900/12 bg-paper-100/70 text-ink-600 hover:bg-paper-200"
          }`}
        >
          {t("all")}
        </Link>
        {REPORT_GROUP_KEYS.map((g) => (
          <Link
            key={g}
            href={withFilter({ group: g })}
            aria-current={group === g ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
              group === g
                ? "border-ink-900 bg-ink-900 font-medium text-paper-50"
                : "border-ink-900/12 bg-paper-100/70 text-ink-600 hover:bg-paper-200"
            }`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{
                background: CATEGORIES[categoriesIn(g)[0]].color,
              }}
              aria-hidden
            />
            {tr(`group.${g}`)}
          </Link>
        ))}
      </nav>

      {/* Beside the chips but outside that nav, which is labelled as the
          category filter: this is not one of the categories, and announcing it
          inside that list would say it was. */}
      <p className="mt-3 text-xs">
        <Link
          href={mapHref}
          className="inline-flex items-center gap-1 py-1 text-ink-600 underline-offset-2 transition hover:text-ink-900 hover:underline"
        >
          {t("viewOnMap")}
          <span aria-hidden>→</span>
        </Link>
      </p>

      {visible.length === 0 ? (
        <p className="mt-8 text-center text-sm text-ink-500">{t("empty")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead className="text-ink-500">
              <tr>
                {showPhotos && (
                  <th scope="col" className="w-14 py-1.5">
                    <span className="sr-only">{t("photo")}</span>
                  </th>
                )}
                <th scope="col" className="py-1.5 font-medium">
                  {t("date")}
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  {t("category")}
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  {t("species")}
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  {t("location")}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-ink-900/10 align-top">
                  {showPhotos && (
                    <td className="py-1.5 pr-3">
                      {thumb.get(r.id) ? (
                        /* eslint-disable-next-line @next/next/no-img-element --
                         a signed Storage URL expires, so next/image's optimiser
                         would cache a URL that stops working. */
                        <img
                          src={thumb.get(r.id)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-10 rounded object-cover"
                        />
                      ) : null}
                    </td>
                  )}
                  <td className="py-1.5 whitespace-nowrap">
                    <Link
                      href={`/reports/${r.id}`}
                      className="text-ink-600 hover:text-ink-800"
                    >
                      {new Date(r.observedAt).toLocaleDateString(locale, {
                        timeZone: "Asia/Taipei",
                      })}
                    </Link>
                  </td>
                  <td className="py-1.5 text-ink-500">{tc(r.category)}</td>
                  <td className="py-1.5">
                    {r.taxonId && r.scientificName ? (
                      <Link
                        href={`/species/${speciesSlug({ id: r.taxonId, scientificName: r.scientificName })}`}
                        className="text-ink-700 hover:text-ember-700"
                      >
                        {zhFirst && r.commonNameZh
                          ? r.commonNameZh
                          : r.scientificName}
                      </Link>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                  <td className="py-1.5 tabular-nums text-ink-500">
                    {r.lat.toFixed(3)}, {r.lng.toFixed(3)}
                    {r.isObscured && (
                      <span
                        className="ml-1.5 text-amber-700"
                        title={tp(r.locationPrecision)}
                      >
                        ≈
                        <span className="sr-only">
                          {" "}
                          {tp(r.locationPrecision)}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The ≈ already carries a title and an sr-only label, so a screen reader
          hears what it means — but a sighted user who does not hover just sees an
          unexplained symbol, on the page whose entire job is being the readable
          version of the map. Shown only when a row on this page actually is
          obscured, so it never explains a mark that is not there. */}
      {rows.some((r) => r.isObscured) && (
        <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
          <span className="text-amber-700">≈</span> {t("obscuredLegend")}
        </p>
      )}

      <nav
        aria-label={t("pagination")}
        className="mt-6 flex items-center justify-between text-xs"
      >
        {page > 1 ? (
          <Link href={qs(page - 1)} className="text-ink-600 hover:text-ink-800">
            ← {t("previous")}
          </Link>
        ) : (
          <span />
        )}
        <span className="text-ink-500">{t("pageN", { page })}</span>
        {hasNext ? (
          <Link href={qs(page + 1)} className="text-ink-600 hover:text-ink-800">
            {t("next")} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
