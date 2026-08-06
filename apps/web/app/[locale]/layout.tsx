import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import ServiceWorker from "@/components/ServiceWorker";
import "../globals.css";

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
    title: { default: t("title"), template: `%s · ${t("title")}` },
    description: t("description"),
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
    <html lang={locale}>
      <body className="h-full antialiased">
        <NextIntlClientProvider>
          <ServiceWorker />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
