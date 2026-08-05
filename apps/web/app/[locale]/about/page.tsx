import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return { title: t("title") };
}

/**
 * Explains the location-obscuring design in plain language.
 *
 * This is the trust surface: conservation researchers will not use a public map
 * of protected species unless they can see exactly how it protects them.
 */
export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");
  const nav = await getTranslations("nav");

  const sections = [
    ["whatTitle", "whatBody"],
    ["privacyTitle", "privacyBody"],
    ["howTitle", "howBody"],
    [null, "howDetail"],
    ["unknownTitle", "unknownBody"],
    ["contributeTitle", "contributeBody"],
  ] as const;

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl px-4 pb-16 pt-5">
      <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">{nav("backToMap")}</Link>
      <h1 className="mt-3 text-xl font-semibold text-slate-50">{t("title")}</h1>

      {sections.map(([heading, body], i) => (
        <section key={i} className={heading ? "mt-6" : "mt-3"}>
          {heading && (
            <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">{t(heading)}</h2>
          )}
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{t(body)}</p>
        </section>
      ))}

      <p className="mt-8 text-xs text-slate-500">
        <Link href="/attribution" className="text-emerald-400 underline-offset-2 hover:underline">
          {nav("attribution")}
        </Link>
        {" · "}
        <Link href="/privacy" className="text-emerald-400 underline-offset-2 hover:underline">
          {nav("privacy")}
        </Link>
      </p>
    </main>
  );
}
