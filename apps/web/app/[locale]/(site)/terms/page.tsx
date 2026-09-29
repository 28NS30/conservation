import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CONSENT_VERSION } from "@conservation/shared";
import PageHeader, { ProseSection } from "@/components/site/PageHeader";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "terms" });
  return { title: t("title") };
}

/**
 * What a reporter agrees to, in plain words, and the version each report
 * records (CONSENT_VERSION, packages/shared; migration 0017).
 *
 * Written to be read by a teenager on a phone. It says what the form's three
 * answers mean — the licence, the credit, and the separate box for sharing a
 * roadkill record with TaiRON — and what we do and do not do with a report.
 * It still needs the owner's legal review (roadmap: "Only Neo can do these");
 * until then it describes the site's actual behaviour and promises nothing the
 * code does not do.
 */
export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("terms");
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "neolava2@gmail.com";

  const sections = [
    ["whatTitle", "whatBody"],
    ["licenceTitle", "licenceBody"],
    ["creditTitle", "creditBody"],
    ["locationTitle", "locationBody"],
    ["partnersTitle", "partnersBody"],
    ["removeTitle", "removeBody"],
    ["youngTitle", "youngBody"],
    ["changesTitle", "changesBody"],
  ] as const;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-12">
      <PageHeader title={t("title")} lede={t("lede", { version: CONSENT_VERSION })} />
      {sections.map(([heading, body]) => (
        <ProseSection key={heading} title={t(heading)}>
          {t(body)}
        </ProseSection>
      ))}
      <p className="mt-10 text-sm text-ink-700">{t("contact", { email: contact })}</p>
    </main>
  );
}
