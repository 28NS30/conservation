import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  countSpecies,
  listSpecies,
  speciesSlug,
  type SpeciesFilter,
} from "@/lib/species";
import { pageWindow } from "@/lib/paging";
import PageHeader from "@/components/site/PageHeader";
import Pager from "@/components/site/Pager";
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

/** 80 rows, which is four screens of the two-column grid on a laptop. */
const PER_PAGE = 80;

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
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { q: rawQ, filter: rawFilter, page: rawPage } = await searchParams;

  const t = await getTranslations("species");

  // Defaults to species that actually have records: only 442 of 68,944 Taiwanese
  // taxa do, so an unfiltered list is 68,500 empty pages and useless as a
  // directory.
  const filter: Filter = (FILTERS as readonly string[]).includes(
    rawFilter ?? "",
  )
    ? (rawFilter as Filter)
    : "recorded";

  const q = rawQ?.trim() || undefined;

  /*
   * Counted before it is listed, because the list is now a window onto the
   * result set rather than the whole of it. The directory asked for 80 rows and
   * showed whatever came back, so 442 recorded species were a list of 80 with
   * nothing on the page admitting the other 362 existed — no count, no pager,
   * no truncation notice. It simply stopped, in alphabetical order, at a place
   * that looked like an ending.
   */
  const total = await countSpecies({ q, filter });
  const win = pageWindow(rawPage, total, PER_PAGE);

  const species = await listSpecies({
    q,
    filter,
    limit: win.perPage,
    offset: win.offset,
  });
  const zhFirst = locale.startsWith("zh");

  /*
   * When a search inside a filter finds nothing, ask whether the filter is what
   * hid it.
   *
   * The default filter is "with records", and most species have none, so typing
   * the name of a real animal that nobody has reported yet answered "no such
   * species" — a directory built on the national checklist telling a reader
   * that a checklist species does not exist. One extra row settles which of the
   * two answers is true.
   */
  const hiddenByFilter =
    species.length === 0 && q && filter !== "all"
      ? (await listSpecies({ q, filter: "all", limit: 1 })).length > 0
      : false;

  const hrefFor = (page: number) => ({
    pathname: "/species" as const,
    query: {
      ...(q ? { q } : {}),
      filter,
      ...(page > 1 ? { page: String(page) } : {}),
    },
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pb-24 pt-12">
      <PageHeader title={t("directory")} lede={t("directoryHint")}>
        <div className="mt-6 max-w-xl">
          <SpeciesSearch initialQuery={rawQ ?? ""} filter={filter} />
        </div>

        <nav className="mt-4 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const on = f === filter;
            // No `page`: a different filter is a different result set, and page
            // 4 of it is not where the reader asked to be.
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
                    ? "border-ink-900 bg-ink-900 font-medium text-paper-50"
                    : "border-ink-900/12 bg-paper-100/70 text-ink-600 hover:bg-paper-200"
                }`}
              >
                {t(`filter.${f}`)}
              </Link>
            );
          })}
        </nav>
      </PageHeader>

      {species.length === 0 ? (
        <div className="mt-8 text-center text-sm text-ink-500">
          {hiddenByFilter ? (
            <>
              <p>
                {t("noMatchesInFilter", {
                  filter: t(`filter.${filter}`),
                  q: q ?? "",
                })}
              </p>
              <Link
                href={{
                  pathname: "/species",
                  query: { ...(q ? { q } : {}), filter: "all" as SpeciesFilter },
                }}
                className="mt-2 inline-flex min-h-11 items-center text-ember-700 transition hover:underline"
              >
                {t("searchAllSpecies")}
              </Link>
            </>
          ) : (
            <p>{t("noMatches")}</p>
          )}
        </div>
      ) : (
        <>
          {/* Where this page sits in the whole. Printed above the grid so the
              reader knows there is more before scrolling to the bottom to find
              out. */}
          <p className="mt-5 text-xs tabular-nums text-ink-500">
            {t("range", {
              from: win.from.toLocaleString(locale),
              to: win.to.toLocaleString(locale),
              total: win.total.toLocaleString(locale),
            })}
          </p>

          {/* Two columns on desktop. At one column the directory was a 640px
              ribbon down the middle of a 1180px page, and 80 results meant six
              screens of scrolling past a mostly empty viewport.

              `grid-cols-1` before that, because a grid with no column template
              has one implicit column sized to its content: the longest
              scientific name in the results set the width of the page, and
              /en/species laid out 364px inside a 320px viewport. */}
          <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-x-4">
            {species.map((s) => {
              const headline =
                zhFirst && s.commonNameZh ? s.commonNameZh : s.scientificName;
              const secondary =
                zhFirst && s.commonNameZh ? s.scientificName : s.commonNameZh;
              return (
                <li key={s.id}>
                  <Link
                    href={`/species/${speciesSlug(s)}`}
                    className="flex h-full items-start justify-between gap-3 rounded-lg border border-ink-900/10 bg-paper-100 px-4 py-3 transition hover:border-ink-900/20 hover:bg-paper-100"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink-800">
                        {headline}
                      </span>
                      {secondary && (
                        <span className="block truncate text-xs italic text-ink-500">
                          {secondary}
                        </span>
                      )}
                      <StatusBadges {...s} />
                    </span>
                    {/* Number and unit on one line: stacked, the lone 筆 read as
                        a stray glyph floating under the count. */}
                    <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-ink-500">
                      <span className="text-sm text-ink-700">
                        {s.reportCount.toLocaleString(locale)}
                      </span>{" "}
                      {t("recordsShort")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <Pager window={win} hrefFor={hrefFor} />
        </>
      )}
    </main>
  );
}
