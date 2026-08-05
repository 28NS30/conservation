import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listSpecies, speciesSlug } from "@/lib/species";
import StatusBadges from "@/components/species/StatusBadges";
import SpeciesSearch from "@/components/species/SpeciesSearch";

export const revalidate = 300;

const FILTERS = ["recorded", "all", "protected", "invasive", "endemic"] as const;
type Filter = (typeof FILTERS)[number];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "species" });
  return { title: t("directory") };
}

export default async function SpeciesDirectory({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { q, filter: rawFilter } = await searchParams;

  const t = await getTranslations("species");
  const nav = await getTranslations("nav");

  // Defaults to species that actually have records: only 354 of 66,201 taxa do,
  // so an unfiltered list is ~65,850 empty pages and useless as a directory.
  const filter: Filter = (FILTERS as readonly string[]).includes(rawFilter ?? "")
    ? (rawFilter as Filter)
    : "recorded";

  const species = await listSpecies({ q: q?.trim() || undefined, filter, limit: 80 });
  const zhFirst = locale.startsWith("zh");

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl px-4 pb-16 pt-5">
      <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">
        {nav("backToMap")}
      </Link>

      <h1 className="mt-3 text-xl font-semibold text-slate-50">{t("directory")}</h1>
      <p className="mt-0.5 text-xs text-slate-400">{t("directoryHint")}</p>

      <div className="mt-4">
        <SpeciesSearch initialQuery={q ?? ""} />
      </div>

      <nav className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const on = f === filter;
          const href = { pathname: "/species" as const, query: { ...(q ? { q } : {}), filter: f } };
          return (
            <Link
              key={f}
              href={href}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                on
                  ? "border-white/70 bg-white/90 font-medium text-slate-900"
                  : "border-white/15 bg-slate-900/70 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {t(`filter.${f}`)}
            </Link>
          );
        })}
      </nav>

      {species.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-500">{t("noMatches")}</p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {species.map((s) => {
            const headline = zhFirst && s.commonNameZh ? s.commonNameZh : s.scientificName;
            const secondary = zhFirst && s.commonNameZh ? s.scientificName : s.commonNameZh;
            return (
              <li key={s.id}>
                <Link
                  href={`/species/${speciesSlug(s)}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2.5 transition hover:border-white/25"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-100">{headline}</span>
                    {secondary && (
                      <span className="block truncate text-xs italic text-slate-500">{secondary}</span>
                    )}
                    <StatusBadges {...s} />
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm tabular-nums text-slate-200">{s.reportCount}</span>
                    <span className="block text-[10px] text-slate-500">{t("recordsShort")}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
