import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Badge from "@/components/brand/Badge";
import { alternates } from "@/lib/alternates";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return { title: t("title"), description: t("whatBody"), alternates: alternates(locale, "/about") };
}

/**
 * Who runs this, how it works, and why some locations are blurred.
 *
 * This is the trust surface: conservation researchers will not use a public map
 * of protected species unless they can see exactly how it protects them. It is
 * also the page a stranger opens to find out who is behind this, which is why it
 * opens with the mark and a lede rather than a bare 20px <h1>.
 *
 * "How it works" and "the data is open" were on the home page until the
 * September 2026 redesign, which kept one line about blurring there and moved
 * the explanations here. Their messages moved with them into the `about`
 * namespace: a key that names the page it is not on is a key the next person to
 * edit this page searches for and does not find.
 *
 * The home page had its own "why some locations are blurred" as well, saying
 * what the section below says in fewer words. There is one now, with the one
 * fact the shorter one had and this did not: which rating decides the blur.
 *
 * The obscuring mechanism no longer gets a write-up of its own. It went into
 * database roles, deterministic offsets and averaging attacks — engineering
 * internals, on the page a stranger reads first. What a reader needs is the
 * promise, not its implementation.
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

  const steps = [
    ["how1", "how1Body"],
    ["how2", "how2Body"],
    ["how3", "how3Body"],
  ] as const;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-14 sm:pt-20">
      <header className="border-b border-ink-900/10 pb-10">
        <Badge size={112} priority />
        {/* The same title as every other inner page (PageHeader), under the
            mark rather than instead of it. */}
        <h1
          className={`mt-6 font-display text-[clamp(2.1rem,6vw,3.2rem)] font-bold leading-[1.05] text-forest-900 [text-wrap:balance] ${
            locale.startsWith("zh") ? "tracking-[0.04em]" : "uppercase tracking-[0.01em]"
          }`}
        >
          {t("title")}
        </h1>
        <span aria-hidden className="mt-4 block h-1 w-14 bg-ember-500" />
        <p className="mt-4 text-[17px] leading-relaxed text-ink-800">
          {site("description")}
        </p>
      </header>

      <Block id="what" title={t("whatTitle")}>
        <p>{t("whatBody")}</p>
      </Block>

      <Block id="how" title={t("howTitle")}>
        <ol className="space-y-5">
          {steps.map(([title, body], i) => (
            <li key={title} className="flex gap-4">
              <span
                aria-hidden
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-forest-900 text-sm font-semibold tabular-nums text-paper-50"
              >
                {(i + 1).toLocaleString(locale)}
              </span>
              <div>
                <h3 className="text-base font-semibold text-ink-900">
                  {t(title)}
                </h3>
                <p className="mt-1">{t(body)}</p>
              </div>
            </li>
          ))}
        </ol>
      </Block>

      {/* `blurred` is linked to from /stats, next to the count of blurred
          records, so it is an address as well as a heading. */}
      <Block id="blurred" title={t("privacyTitle")}>
        <p>{t("privacyBody")}</p>
      </Block>

      <Block id="unidentified" title={t("unknownTitle")}>
        <p>{t("unknownBody")}</p>
      </Block>

      <Block id="open-data" title={t("openTitle")}>
        <p>{t("openBody")}</p>
        <Link
          href="/attribution"
          className="mt-3 inline-flex min-h-11 items-center text-ember-700 underline-offset-2 hover:underline"
        >
          {t("openLink")} →
        </Link>
      </Block>

      <Block id="take-part" title={t("contributeTitle")}>
        <p>{t("contributeBody")}</p>
      </Block>

      <Block id="contact" title={t("contactTitle")}>
        <p>{t("contactBody")}</p>
        <a
          href={`mailto:${contact}`}
          className="mt-2 inline-flex min-h-11 items-center text-ember-700 underline-offset-2 hover:underline"
        >
          {contact}
        </a>
      </Block>

      <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-ink-900/10 pt-8">
        {/* The same words as the header's action. There were eight labels for
            this one thing across the site; this page no longer adds a ninth. */}
        <Link
          href="/report"
          className="inline-flex min-h-11 items-center rounded-full bg-ember-500 px-5 text-sm font-semibold text-bark-950 transition hover:bg-ember-400"
        >
          {nav("fileReport")}
        </Link>
        <Link
          href="/attribution"
          className="inline-flex min-h-11 items-center rounded-full border border-ink-900/20 px-5 text-sm text-ink-800 transition hover:border-ink-900/35 hover:bg-ink-900/5"
        >
          {nav("attribution")}
        </Link>
        <Link
          href="/privacy"
          className="inline-flex min-h-11 items-center rounded-full border border-ink-900/20 px-5 text-sm text-ink-800 transition hover:border-ink-900/35 hover:bg-ink-900/5"
        >
          {nav("privacy")}
        </Link>
      </div>
    </main>
  );
}

function Block({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  // scroll-mt clears the sticky header when a link lands on the section.
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-12 scroll-mt-28">
      <h2 id={`${id}-title`} className="text-xl font-semibold text-forest-900">
        {title}
      </h2>
      <div className="mt-3 text-base leading-relaxed text-ink-800">{children}</div>
    </section>
  );
}
