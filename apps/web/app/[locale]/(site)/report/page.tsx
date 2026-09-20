import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader from "@/components/site/PageHeader";
import ReportForm from "@/components/report/ReportForm";
import { CATEGORY_KEYS, type Category } from "@conservation/shared";
import QueueBanner from "@/components/report/QueueBanner";
import { getSpecies, parseSpeciesId } from "@/lib/species";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "report" });
  return { title: t("heading") };
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string; taxonId?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("report");

  // Anything else in the query string is ignored rather than rejected: a bad
  // ?category= is a mistyped link, not an attack, and the form simply opens on
  // its default.
  const { category, taxonId } = await searchParams;
  const initialCategory = CATEGORY_KEYS.includes(category as Category)
    ? (category as Category)
    : undefined;

  /*
   * "Report this species" arrives with the species already named.
   *
   * Looked up with getSpecies rather than the map's named-taxon helper, which
   * only knows taxa that have been reported: the loudest case for this link is
   * the species page that says nobody has reported this yet, and a prefill that
   * worked for everything except the empty pages would miss the reason it
   * exists. getSpecies reads through asPublic like everything else, so a taxon
   * whose coordinates are withheld still reports zero records here.
   *
   * A malformed or unknown id is ignored on the same grounds as a bad
   * ?category=: it is a mistyped link, and the form simply opens unfilled.
   */
  const id = taxonId ? parseSpeciesId(taxonId) : null;
  const found = id ? await getSpecies(id) : null;
  const initialSpecies = found
    ? {
        id: found.id,
        scientificName: found.scientificName,
        commonNameZh: found.commonNameZh,
        isInvasive: found.isInvasive,
        reportCount: found.reportCount,
      }
    : undefined;

  return (
    <main className="mx-auto w-full max-w-xl px-6 pb-24 pt-12">
      <PageHeader title={t("heading")} lede={t("subheading")} />

      <QueueBanner />

      <ReportForm
        maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
        initialCategory={initialCategory}
        initialSpecies={initialSpecies}
      />

      <p className="mt-8 text-[11px] leading-relaxed text-ink-500">
        {t("privacyNote")}
      </p>
    </main>
  );
}
