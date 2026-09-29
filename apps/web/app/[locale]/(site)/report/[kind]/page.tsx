import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  REPORT_PAGE_KEYS,
  isReportPage,
  type ReportPage,
} from "@conservation/shared";
import ReportForm from "@/components/report/ReportForm";
import QueueBanner from "@/components/report/QueueBanner";
import WarmReportPages from "@/components/report/WarmReportPages";
import ReportKindIcon from "@/components/report/ReportKindIcon";
import { parseSpeciesId, reportableSpecies } from "@/lib/species";
import { ROW_KEY } from "@/lib/report/pages";
import { alternates } from "@/lib/alternates";

/**
 * The three report pages: /report/roadkill, /report/invasive, /report/wildlife.
 *
 * One dynamic segment rather than three page files, for the offline case: a
 * single page module is one set of JavaScript chunks, so a phone that has
 * loaded any one of the three already holds the code for all of them, and
 * WarmReportPages fetches the other two pages' HTML. `dynamicParams = false`
 * makes anything else under /report/ a 404 rather than a form for a kind that
 * does not exist — the pattern lab/[direction]/layout.tsx already uses.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return REPORT_PAGE_KEYS.map((kind) => ({ kind }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; kind: string }>;
}): Promise<Metadata> {
  const { locale, kind } = await params;
  if (!isReportPage(kind)) return {};
  const t = await getTranslations({ locale, namespace: "report" });
  const th = await getTranslations({ locale, namespace: "home" });
  // The same words as the home page's row for this kind of report.
  const body = { roadkill: "rowRoadkillBody", invasive: "rowInvasiveBody", wildlife: "rowSightingBody" } as const;
  return {
    title: t(`pages.${kind}`),
    description: th(body[kind]),
    alternates: alternates(locale, `/report/${kind}`),
  };
}

const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

export default async function ReportKindPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; kind: string }>;
  searchParams: Promise<{
    taxonId?: string | string[];
    test?: string | string[];
  }>;
}) {
  const { locale, kind } = await params;
  // Belt and braces for development, where params are generated on
  // navigation rather than at build.
  if (!isReportPage(kind)) notFound();
  setRequestLocale(locale);

  const [t, home] = await Promise.all([
    getTranslations("report"),
    getTranslations("home"),
  ]);
  const zh = locale.startsWith("zh");

  /*
   * "Report this species" arrives with the species already named, and it is
   * the only thing that is ever preselected — because the reporter chose it,
   * on the page they came from.
   *
   * Looked up with reportableSpecies rather than the map's named-taxon helper,
   * which only knows taxa that have been reported: the loudest case for this
   * link is the species page that says nobody has reported this yet. It reads
   * through asPublic like everything else, so a taxon whose coordinates are
   * withheld still reports zero records here.
   *
   * A malformed or unknown id is ignored, as is a name this page does not
   * take: retired by TaiCOL, not recorded in Taiwan, or — on the invasive
   * page — not an invasive animal. Prefilled, it would be sent as the report's
   * species and the server would not file it as named, or would refuse it; the
   * offline queue treats a refusal as final. Unfilled, the reporter picks from
   * names that work.
   */
  const query = await searchParams;
  const taxonParam = first(query.taxonId);
  const id = taxonParam ? parseSpeciesId(taxonParam) : null;
  const found = id ? await reportableSpecies(id) : null;
  const initialSpecies =
    found && found.pages.includes(kind)
      ? {
          id: found.id,
          taicolId: found.taicolId,
          scientificName: found.scientificName,
          commonNameZh: found.commonNameZh,
          commonNameEn: found.commonNameEn,
          isInvasive: found.isInvasive,
          reportCount: found.reportCount,
        }
      : undefined;

  // A moderator's test report, from the links on /admin (migration 0018).
  // Only a flag for the form: the server decides who may send one.
  const test = first(query.test) === "1";

  const others = REPORT_PAGE_KEYS.filter((p): p is ReportPage => p !== kind);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
      <header className="mb-8">
        <Link
          href="/report"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
        >
          <span aria-hidden>←</span>
          {t("allKinds")}
        </Link>
        <div className="mt-4 flex items-start gap-4">
          <ReportKindIcon page={kind} size="sm" />
          <h1
            className={`font-display text-[clamp(2rem,8vw,2.75rem)] font-bold leading-[1.02] text-forest-900 [text-wrap:balance] ${
              zh ? "tracking-[0.02em]" : "uppercase tracking-[0.01em]"
            }`}
          >
            {t(`pages.${kind}`)}
          </h1>
        </div>
        <span aria-hidden className="mt-5 block h-1.5 w-16 bg-ember-500" />
        <p className="mt-5 text-[17px] leading-relaxed text-ink-800">
          {home(`row${ROW_KEY[kind]}Body`)}
        </p>
        {/*
          The way out for someone on the wrong page — a live animal on the
          roadkill page, a dead one on the wildlife page — named in the home
          page's words. Near the top, before anything has been typed.
        */}
        <nav aria-label={t("otherKinds")} className="mt-4 text-sm text-ink-700">
          <span>{t("otherKinds")}</span>{" "}
          {others.map((p, i) => (
            <span key={p}>
              {i > 0 && <span aria-hidden> · </span>}
              <Link
                href={`/report/${p}`}
                className="inline-flex min-h-11 items-center font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
              >
                {home(`row${ROW_KEY[p]}Cta`)}
              </Link>
            </span>
          ))}
        </nav>
      </header>

      <QueueBanner />

      <ReportForm
        page={kind}
        maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
        initialSpecies={initialSpecies}
        test={test}
      />

      <p className="mt-10 text-sm leading-relaxed text-ink-700">
        {t("privacyNote")}
      </p>

      <WarmReportPages />
    </main>
  );
}
