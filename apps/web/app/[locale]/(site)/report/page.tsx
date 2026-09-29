import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import {
  REPORT_PAGE_KEYS,
  legacyReportPage,
  type ReportPage,
} from "@conservation/shared";
import QueueBanner from "@/components/report/QueueBanner";
import WarmReportPages from "@/components/report/WarmReportPages";
import ReportKindIcon from "@/components/report/ReportKindIcon";
import { parseSpeciesId, reportableSpecies } from "@/lib/species";
import { ROW_KEY, reportPageHref } from "@/lib/report/pages";
import SpeciesName from "@/components/species/SpeciesName";
import { alternates } from "@/lib/alternates";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  const tr = await getTranslations({ locale, namespace: "report" });
  return {
    title: t("fileReport"),
    description: tr("metaDescription"),
    alternates: alternates(locale, "/report"),
  };
}

/** A query value, whichever shape Next hands it over in. */
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

/**
 * "File a report": the three kinds, and nothing else to do here.
 *
 * The team asked for three report pages rather than one form that opens by
 * asking which kind of report this is (requests 3 and 9), so /report is the
 * door to them. Each choice is described in the home page's own words — its
 * three report rows — so the home page, this page and the header's menu cannot
 * describe the same choice three ways (lib/report/pages.ts).
 *
 * OLD LINKS. `/report?category=` was how the home page, the header and every
 * shared link chose a kind, and those links are out in the world. Each is sent
 * on to its page with a temporary redirect (307, not 308, so no browser
 * remembers it if the structure moves again), keeping the species it named
 * and nothing else. `?category=injured` lands on the roadkill page with the
 * dead-or-hurt question unanswered: a silent default on condition is how
 * injured animals were filed as dead ones. A value that never named a
 * category is a mistyped link, not an attack, and gets this page.
 *
 * A SPECIES LINK. "Report this species" on a species page arrives here as
 * `?taxonId=`, because only the reporter knows whether the animal was dead or
 * alive. The page says which animal, and each choice that takes it carries it
 * on; a choice whose list does not include it (the invasive page, for a native
 * animal) opens unfilled rather than with a name the server would refuse.
 *
 * The waiting-reports banner is here as on the three pages: a report saved
 * with no signal is sent from whichever report page is open next.
 */
export default async function ReportChooserPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    category?: string | string[];
    taxonId?: string | string[];
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const query = await searchParams;
  const taxonParam = first(query.taxonId);
  const id = taxonParam ? parseSpeciesId(taxonParam) : null;

  const legacy = legacyReportPage(first(query.category));
  if (legacy) {
    redirect({ href: reportPageHref(legacy, id), locale });
  }

  const [t, nav, home] = await Promise.all([
    getTranslations("report"),
    getTranslations("nav"),
    getTranslations("home"),
  ]);
  const zh = locale.startsWith("zh");
  const species = id ? await reportableSpecies(id) : null;
  const carries = (page: ReportPage) =>
    species?.pages.includes(page) ? species.id : null;

  return (
    <main className="mx-auto w-full max-w-[1100px] px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
      <header className="mx-auto max-w-2xl text-center">
        <h1
          className={`font-display text-[clamp(2.4rem,9vw,3.6rem)] font-bold leading-none text-forest-900 [text-wrap:balance] ${
            zh ? "tracking-[0.04em]" : "uppercase tracking-[0.02em]"
          }`}
        >
          {nav("fileReport")}
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-800">
          {home("askHint")}
        </p>
        <span aria-hidden className="mx-auto mt-6 block h-1 w-16 bg-ember-500" />
      </header>

      <div className="mx-auto mt-8 max-w-2xl">
        <QueueBanner />
      </div>

      {species && (
        <div className="mx-auto mt-2 max-w-2xl rounded-lg border border-forest-900/20 bg-paper-100 px-5 py-4 text-center">
          <p className="text-sm text-ink-700">{t("chooserSpecies")}</p>
          <p className="mt-1">
            <SpeciesName
              species={species}
              locale={locale}
              primaryClassName="text-lg font-semibold text-ink-950"
              secondaryClassName="text-sm text-ink-700"
            />
          </p>
        </div>
      )}

      <ul className="mt-10 grid gap-5 md:grid-cols-3 md:gap-6">
        {REPORT_PAGE_KEYS.map((page) => {
          const key = ROW_KEY[page];
          return (
            <li key={page}>
              <Link
                href={reportPageHref(page, carries(page))}
                className="group flex h-full flex-col border-2 border-forest-900/15 bg-paper-100 p-6 transition hover:border-forest-900 sm:p-7"
              >
                <ReportKindIcon page={page} />
                <h2
                  className={`mt-5 font-display text-[clamp(1.6rem,5vw,2rem)] font-bold leading-[1.05] text-forest-900 [text-wrap:balance] ${
                    zh ? "tracking-[0.02em]" : "uppercase tracking-[0.01em]"
                  }`}
                >
                  {home(`row${key}Title`)}
                </h2>
                <p className="mt-3 text-base leading-relaxed text-ink-800">
                  {home(`row${key}Body`)}
                </p>
                <span className="mt-auto pt-6">
                  <span className="inline-flex min-h-12 items-center gap-2 bg-leaf-600 px-5 font-display text-[17px] font-semibold uppercase tracking-[0.06em] text-white transition group-hover:bg-leaf-700">
                    {home(`row${key}Cta`)}
                    <span aria-hidden>→</span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-ink-700">
        {t("privacyNote")}
      </p>

      <WarmReportPages />
    </main>
  );
}
