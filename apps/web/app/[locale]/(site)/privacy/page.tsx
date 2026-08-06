import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy" });
  return { title: t("title") };
}

/**
 * A factual description of what the system actually does with data, rather than
 * generic boilerplate. Taiwan's 個人資料保護法 applies since we collect location
 * and, optionally, an email address.
 */
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");

  const sections = [
    ["collectTitle", "collectBody"],
    ["photosTitle", "photosBody"],
    ["locationTitle", "locationBody"],
    ["retentionTitle", "retentionBody"],
    ["thirdPartyTitle", "thirdPartyBody"],
    ["cookiesTitle", "cookiesBody"],
  ] as const;

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl px-4 pb-16 pt-5">
      <h1 className="mt-3 text-xl font-semibold text-parchment-50">{t("title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-parchment-400">{t("intro")}</p>

      {sections.map(([heading, body]) => (
        <section key={heading} className="mt-6">
          <h2 className="text-xs font-medium uppercase tracking-wide text-parchment-500">{t(heading)}</h2>
          <p className="mt-2 text-sm leading-relaxed text-parchment-300">{t(body)}</p>
        </section>
      ))}
    </main>
  );
}
