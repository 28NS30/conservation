import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { clientMessages } from "@/i18n/clientMessages";
import { routing } from "@/i18n/routing";
import ServiceWorker from "@/components/ServiceWorker";
import QueueReminderLoader from "@/components/offline/QueueReminderLoader";
import { Analytics } from "@vercel/analytics/next";
import { Barlow_Condensed } from "next/font/google";
import "../globals.css";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * The one web font, for headlines only — the bold condensed voice of the team's
 * design brief. next/font self-hosts it, so a visitor's browser never contacts
 * Google and the privacy page has nothing new to disclose. Latin only: Chinese
 * headlines fall through `--font-display` to the platform's CJK sans, because
 * no condensed Hanzi face is worth shipping to every visitor for a headline.
 */
const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-barlow-condensed",
  display: "swap",
  // Not preloaded. Declared here it would otherwise be preloaded on EVERY route,
  // the map included, and perf.spec rightly fails that: the map is the heaviest
  // page and loads no web font. Unpreloaded, the browser fetches it only where
  // text actually uses it — and the map's header deliberately does not.
  preload: false,
});

/**
 * Open Graph's form of each locale, language_TERRITORY. The English catalogue
 * is written in British spelling ("colour", "licence").
 */
const OG_LOCALE: Record<string, string> = { "zh-TW": "zh_TW", en: "en_GB" };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site" });
  return {
    // Inner pages set a bare page title ("關於本站"); the template is what puts
    // the project's name behind it in the tab and in a shared link. The home
    // page opts out with `title: { absolute }` so it is not named twice.
    // Absolute URLs for canonical and language links (lib/alternates.ts) and
    // for share cards, from the one place the site's address is decided.
    metadataBase: new URL(SITE_URL),
    title: { default: t("title"), template: `%s · ${t("title")}` },
    description: t("description"),
    // What a shared link's preview names the site as, and in which language.
    // Next fills og:title and og:description from each page's own title and
    // description; these three were missing from every page, so a preview had
    // no site name beside the page's. No page sets openGraph of its own, so
    // this is every page's.
    openGraph: {
      siteName: t("title"),
      type: "website",
      locale: OG_LOCALE[locale] ?? OG_LOCALE[routing.defaultLocale],
      alternateLocale: routing.locales
        .filter((l) => l !== locale)
        .map((l) => OG_LOCALE[l]),
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Opts the route into static rendering; without it every page becomes dynamic.
  setRequestLocale(locale);

  return (
    <html lang={locale} className={display.variable}>
      <body className="h-full antialiased">
        {/* Only what code in the browser reads (i18n/clientMessages.ts). */}
        <NextIntlClientProvider messages={clientMessages(await getMessages())}>
          <ServiceWorker />
          {children}
          {/* A report still on this phone, said on every page; idle-loaded so
              the map's first load does not carry it. */}
          <QueueReminderLoader />
        </NextIntlClientProvider>
        {/* Page-view counts only. Cookieless and with no cross-site identifier,
            which is what keeps the promise /privacy already makes — no
            advertising or tracking cookies. It is here rather than omitted
            because without it "does the landing page lead to a report" is
            unanswerable even after launch, and that is the question the design
            exists to get right.

            Only on Vercel: the script lives at /_vercel/insights/script.js,
            which the platform serves and nothing else does. Under `next start`
            anywhere else — including CI — it 404s on every page, which failed
            all thirteen page renders and looked like a site-wide breakage. */}
        {process.env.VERCEL && <Analytics />}
      </body>
    </html>
  );
}
