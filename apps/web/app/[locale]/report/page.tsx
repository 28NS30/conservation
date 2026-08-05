import { Link } from "@/i18n/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ReportForm from "@/components/report/ReportForm";
import QueueBanner from "@/components/report/QueueBanner";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "report" });
  return { title: t("heading") };
}

export default async function ReportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("report");
  const nav = await getTranslations("nav");

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-xl px-4 pb-16 pt-5">
      <header className="mb-6">
        <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">
          {nav("backToMap")}
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-slate-50">{t("heading")}</h1>
        <p className="text-xs text-slate-400">{t("subheading")}</p>
      </header>

      <QueueBanner />

      <ReportForm maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined} />

      <p className="mt-8 text-[11px] leading-relaxed text-slate-500">{t("privacyNote")}</p>
    </main>
  );
}
