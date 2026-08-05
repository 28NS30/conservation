import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { asPublic } from "@/lib/db";
import {
  CATEGORIES,
  CATEGORY_KEYS,
  filterToQuery,
  mapFilterSchema,
  type Category,
  type LocationPrecision,
} from "@conservation/shared";
import { speciesSlug } from "@/lib/species";

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
  const rawCategory = typeof sp.category === "string" ? sp.category : undefined;
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
  const nav = await getTranslations("nav");
  const tc = await getTranslations("categories");
  const tp = await getTranslations("precision");

  const category = (CATEGORY_KEYS as string[]).includes(rawCategory ?? "")
    ? (rawCategory as Category)
    : null;
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
       where (${category}::text is null or rp.category = ${category})
         and (${taxonId}::bigint is null or rp.taxon_id = ${taxonId})
         and (${from}::date is null or rp.observed_at >= ${from}::date)
         and (${to}::date   is null or rp.observed_at <  (${to}::date + 1))
       order by rp.observed_at desc
       limit ${PAGE_SIZE + 1} offset ${offset}`,
  );

  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);
  const zhFirst = locale.startsWith("zh");

  /** Carry every active filter through paging and the category chips. */
  const activeFilter = filterToQuery({
    ...(category ? { category } : {}),
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

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-3xl px-4 pb-16 pt-5">
      <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">
        {nav("backToMap")}
      </Link>
      <h1 className="mt-3 text-xl font-semibold text-slate-50">{t("title")}</h1>
      <p className="mt-0.5 text-xs text-slate-400">{t("subtitle")}</p>

      <nav aria-label={t("filterByCategory")} className="mt-4 flex flex-wrap gap-1.5">
        <Link
          href={
            withFilter({}).replace(/([?&])category=[^&]*&?/, "$1").replace(/[?&]$/, "") ||
            "/reports"
          }
          aria-current={!category ? "page" : undefined}
          className={`rounded-full border px-3 py-1.5 text-xs transition ${
            !category
              ? "border-white/70 bg-white/90 font-medium text-slate-900"
              : "border-white/15 bg-slate-900/70 text-slate-300 hover:bg-slate-800"
          }`}
        >
          {t("all")}
        </Link>
        {CATEGORY_KEYS.map((k) => (
          <Link
            key={k}
            href={withFilter({ category: k })}
            aria-current={category === k ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
              category === k
                ? "border-white/70 bg-white/90 font-medium text-slate-900"
                : "border-white/15 bg-slate-900/70 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: CATEGORIES[k].color }} aria-hidden />
            {tc(k)}
          </Link>
        ))}
      </nav>

      {visible.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-500">{t("empty")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead className="text-slate-500">
              <tr>
                <th scope="col" className="py-1.5 font-medium">{t("date")}</th>
                <th scope="col" className="py-1.5 font-medium">{t("category")}</th>
                <th scope="col" className="py-1.5 font-medium">{t("species")}</th>
                <th scope="col" className="py-1.5 font-medium">{t("location")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-white/5 align-top">
                  <td className="py-1.5 whitespace-nowrap">
                    <Link href={`/reports/${r.id}`} className="text-slate-300 hover:text-slate-100">
                      {new Date(r.observedAt).toLocaleDateString(locale, { timeZone: "Asia/Taipei" })}
                    </Link>
                  </td>
                  <td className="py-1.5 text-slate-400">{tc(r.category)}</td>
                  <td className="py-1.5">
                    {r.taxonId && r.scientificName ? (
                      <Link
                        href={`/species/${speciesSlug({ id: r.taxonId, scientificName: r.scientificName })}`}
                        className="text-slate-200 hover:text-emerald-300"
                      >
                        {zhFirst && r.commonNameZh ? r.commonNameZh : r.scientificName}
                      </Link>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="py-1.5 tabular-nums text-slate-400">
                    {r.lat.toFixed(3)}, {r.lng.toFixed(3)}
                    {r.isObscured && (
                      <span className="ml-1.5 text-amber-400" title={tp(r.locationPrecision)}>
                        ≈<span className="sr-only"> {tp(r.locationPrecision)}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label={t("pagination")} className="mt-6 flex items-center justify-between text-xs">
        {page > 1 ? (
          <Link href={qs(page - 1)} className="text-slate-300 hover:text-slate-100">← {t("previous")}</Link>
        ) : <span />}
        <span className="text-slate-500">{t("pageN", { page })}</span>
        {hasNext ? (
          <Link href={qs(page + 1)} className="text-slate-300 hover:text-slate-100">{t("next")} →</Link>
        ) : <span />}
      </nav>
    </main>
  );
}
