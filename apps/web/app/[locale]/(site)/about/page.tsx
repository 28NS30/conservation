import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Badge from "@/components/brand/Badge";

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
 * The obscuring mechanism no longer gets a write-up of its own. It said the
 * same thing as the section above it and then kept going into database roles,
 * deterministic offsets and averaging attacks — engineering internals, on the
 * page a stranger reads first. What a reader needs is the promise, not its
 * implementation: sensitive species are published at a coarse location, and the
 * most sensitive not at all. That now lives in one paragraph.
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

  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "neolava2@gmail.com";

  const sections = [
    ["whatTitle", "whatBody"],
    ["privacyTitle", "privacyBody"],
    ["unknownTitle", "unknownBody"],
    ["contributeTitle", "contributeBody"],
  ] as const;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-14 sm:pt-20">
      <header className="border-b border-ink-900/10 pb-10">
        <Badge size={112} priority />
        <h1 className="mt-6 text-3xl font-semibold leading-tight text-ink-900">
          {t("title")}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-700">
          {site("description")}
        </p>
      </header>

      {sections.map(([heading, body]) => (
        <Block key={heading} title={t(heading)} body={t(body)} />
      ))}

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-ink-900">
          {t("contactTitle")}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-600">
          {t("contactBody")}
        </p>
        <a
          href={`mailto:${contact}`}
          className="mt-2 inline-block text-sm text-ember-700 underline-offset-2 hover:underline"
        >
          {contact}
        </a>
      </section>

      <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-ink-900/10 pt-8">
        <Link
          href="/report"
          className="rounded-full bg-ember-500 px-5 py-2.5 text-sm font-semibold text-bark-950 transition hover:bg-ember-400"
        >
          + {nav("report")}
        </Link>
        <Link
          href="/attribution"
          className="rounded-full border border-ink-900/20 px-5 py-2.5 text-sm text-ink-800 transition hover:border-ink-900/35 hover:bg-ink-900/5"
        >
          {nav("attribution")}
        </Link>
        <Link
          href="/privacy"
          className="rounded-full border border-ink-900/20 px-5 py-2.5 text-sm text-ink-800 transition hover:border-ink-900/35 hover:bg-ink-900/5"
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
      <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">{body}</p>
    </section>
  );
}
