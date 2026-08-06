import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader from "@/components/site/PageHeader";
import ReportForm from "@/components/report/ReportForm";
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
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("report");

  return (
    <main className="mx-auto w-full max-w-xl px-6 pb-24 pt-12">
      <PageHeader title={t("heading")} lede={t("subheading")} />

      <QueueBanner />

      <ReportForm
        maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
      />

      <p className="mt-8 text-[11px] leading-relaxed text-parchment-500">
        {t("privacyNote")}
      </p>
    </main>
  );
}
