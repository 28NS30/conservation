import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader, { ProseSection } from "@/components/site/PageHeader";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy" });
  return { title: t("title") };
}

/**
 * A factual description of what the system actually does with data, rather than
 * generic boilerplate. Taiwan's 個人資料保護法 applies since we collect location
 * and, optionally, an email address.
 */
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");

  const sections = [
    ["collectTitle", "collectBody"],
    ["photosTitle", "photosBody"],
    ["locationTitle", "locationBody"],
    ["retentionTitle", "retentionBody"],
    ["thirdPartyTitle", "thirdPartyBody"],
    ["analyticsTitle", "analyticsBody"],
    ["cookiesTitle", "cookiesBody"],
  ] as const;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-12">
      <PageHeader title={t("title")} lede={t("intro")} />

      {sections.map(([heading, body]) => (
        <ProseSection key={heading} title={t(heading)}>
          {t(body)}
        </ProseSection>
      ))}
    </main>
  );
}
