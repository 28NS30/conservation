import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader from "@/components/site/PageHeader";
import ReportForm from "@/components/report/ReportForm";
import { CATEGORY_KEYS, type Category } from "@conservation/shared";
import QueueBanner from "@/components/report/QueueBanner";

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
  searchParams: Promise<{ category?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("report");

  // Anything else in the query string is ignored rather than rejected: a bad
  // ?category= is a mistyped link, not an attack, and the form simply opens on
  // its default.
  const { category } = await searchParams;
  const initialCategory = CATEGORY_KEYS.includes(category as Category)
    ? (category as Category)
    : undefined;

  return (
    <main className="mx-auto w-full max-w-xl px-6 pb-24 pt-12">
      <PageHeader title={t("heading")} lede={t("subheading")} />

      <QueueBanner />

      <ReportForm
        maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
        initialCategory={initialCategory}
      />

      <p className="mt-8 text-[11px] leading-relaxed text-ink-500">
        {t("privacyNote")}
      </p>
    </main>
  );
}
