import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Mark from "@/components/brand/Mark";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return { title: t("title") };
}

/**
 * Explains the location-obscuring design in plain language.
 *
 * This is the trust surface: conservation researchers will not use a public map
 * of protected species unless they can see exactly how it protects them. It is
 * also the page a stranger opens to find out who is behind this, which is why it
 * now opens with the mark and a lede rather than a bare 20px <h1>.
 *
 * The obscuring mechanism gets a panel of its own instead of being the third of
 * six identical prose blocks — it is the one claim this whole page exists to
 * make credible.
 */
export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");
  const nav = await getTranslations("nav");
  const site = await getTranslations("site");

  const before = [
    ["whatTitle", "whatBody"],
    ["privacyTitle", "privacyBody"],
  ] as const;
  const after = [
    ["unknownTitle", "unknownBody"],
    ["contributeTitle", "contributeBody"],
  ] as const;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-14 sm:pt-20">
      <header className="border-b border-parchment-200/10 pb-10">
        <Mark className="size-16" />
        <h1 className="mt-6 text-3xl font-semibold leading-tight text-parchment-50">
          {t("title")}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-parchment-200">
          {site("description")}
        </p>
      </header>

      {before.map(([heading, body]) => (
        <Block key={heading} title={t(heading)} body={t(body)} />
      ))}

      {/* The trust centrepiece. Everything else here is context for it. */}
      <section className="mt-12 rounded-xl border border-parchment-200/15 bg-bark-900 p-7">
        <h2 className="text-lg font-semibold text-parchment-50">
          {t("howTitle")}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-parchment-200">
          {t("howBody")}
        </p>
        <p className="mt-4 border-l-2 border-ember-500/40 pl-4 text-sm leading-relaxed text-parchment-300">
          {t("howDetail")}
        </p>
      </section>

      {after.map(([heading, body]) => (
        <Block key={heading} title={t(heading)} body={t(body)} />
      ))}

      <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-parchment-200/10 pt-8">
        <Link
          href="/report"
          className="rounded-full bg-ember-500 px-5 py-2.5 text-sm font-semibold text-bark-950 transition hover:bg-ember-400"
        >
          + {nav("report")}
        </Link>
        <Link
          href="/attribution"
          className="rounded-full border border-parchment-200/25 px-5 py-2.5 text-sm text-parchment-100 transition hover:border-parchment-200/50 hover:bg-parchment-50/5"
        >
          {nav("attribution")}
        </Link>
        <Link
          href="/privacy"
          className="rounded-full border border-parchment-200/25 px-5 py-2.5 text-sm text-parchment-100 transition hover:border-parchment-200/50 hover:bg-parchment-50/5"
        >
          {nav("privacy")}
        </Link>
      </div>
    </main>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold text-parchment-50">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-parchment-300">{body}</p>
    </section>
  );
}
