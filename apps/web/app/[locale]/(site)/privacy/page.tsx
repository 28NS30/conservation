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

  /*
   * Taiwan's 個資法 gives people the right to see, correct and delete their own
   * data. A privacy policy that describes that right and gives no way to
   * exercise it does not grant one — this page said "please contact us" and
   * named nobody.
   */
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "neolava2@gmail.com";

  return (
    <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-12">
      <PageHeader title={t("title")} lede={t("intro")} />

      {sections.map(([heading, body]) => (
        <ProseSection key={heading} title={t(heading)}>
          {t(body)}
        </ProseSection>
      ))}

      <ProseSection title={t("contactTitle")}>
        {t("contactBody")}
        <a
          href={`mailto:${contact}`}
          className="mt-3 block text-ember-700 underline-offset-2 hover:underline"
        >
          {contact}
        </a>
      </ProseSection>
    </main>
  );
}
