import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listSpecies, speciesSlug } from "@/lib/species";
import PageHeader from "@/components/site/PageHeader";
import StatusBadges from "@/components/species/StatusBadges";
import SpeciesSearch from "@/components/species/SpeciesSearch";

export const revalidate = 300;

const FILTERS = [
  "recorded",
  "all",
  "protected",
  "invasive",
  "endemic",
] as const;
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

  // Defaults to species that actually have records: only 354 of 66,201 taxa do,
  // so an unfiltered list is ~65,850 empty pages and useless as a directory.
  const filter: Filter = (FILTERS as readonly string[]).includes(
    rawFilter ?? "",
  )
    ? (rawFilter as Filter)
    : "recorded";

  const species = await listSpecies({
    q: q?.trim() || undefined,
    filter,
    limit: 80,
  });
  const zhFirst = locale.startsWith("zh");

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pb-24 pt-12">
      <PageHeader title={t("directory")} lede={t("directoryHint")}>
        <div className="mt-6 max-w-xl">
          <SpeciesSearch initialQuery={q ?? ""} />
        </div>

        <nav className="mt-4 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const on = f === filter;
            const href = {
              pathname: "/species" as const,
              query: { ...(q ? { q } : {}), filter: f },
            };
            return (
              <Link
                key={f}
                href={href}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  on
                    ? "border-parchment-200/70 bg-parchment-50/90 font-medium text-bark-950"
                    : "border-parchment-200/15 bg-bark-900/70 text-parchment-300 hover:bg-bark-800"
                }`}
              >
                {t(`filter.${f}`)}
              </Link>
            );
          })}
        </nav>
      </PageHeader>

      {species.length === 0 ? (
        <p className="mt-8 text-center text-sm text-parchment-500">
          {t("noMatches")}
        </p>
      ) : (
        // Two columns on desktop. At one column the directory was a 640px ribbon
        // down the middle of a 1180px page, and 80 results meant six screens of
        // scrolling past a mostly empty viewport.
        <ul className="mt-5 grid gap-1.5 sm:grid-cols-2 sm:gap-x-4">
          {species.map((s) => {
            const headline =
              zhFirst && s.commonNameZh ? s.commonNameZh : s.scientificName;
            const secondary =
              zhFirst && s.commonNameZh ? s.scientificName : s.commonNameZh;
            return (
              <li key={s.id}>
                <Link
                  href={`/species/${speciesSlug(s)}`}
                  className="flex h-full items-start justify-between gap-3 rounded-lg border border-parchment-200/10 bg-bark-900/50 px-4 py-3 transition hover:border-parchment-200/25 hover:bg-bark-900"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-parchment-100">
                      {headline}
                    </span>
                    {secondary && (
                      <span className="block truncate text-xs italic text-parchment-500">
                        {secondary}
                      </span>
                    )}
                    <StatusBadges {...s} />
                  </span>
                  {/* Number and unit on one line: stacked, the lone 筆 read as a
                      stray glyph floating under the count. */}
                  <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-parchment-400">
                    <span className="text-sm text-parchment-200">
                      {s.reportCount.toLocaleString(locale)}
                    </span>{" "}
                    {t("recordsShort")}
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
