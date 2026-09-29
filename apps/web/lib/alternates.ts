import type { Metadata } from "next";
import { SITE_URL } from "@/lib/siteUrl";
import { routing } from "@/i18n/routing";

/**
 * A page's canonical address, and its address in the other language.
 *
 * No page said which URL was the page. /species?filter=protected and
 * /reports?taxonId=… were indexed as pages of their own with the same title as
 * /species and /reports, and nothing told a search engine that /en/about is the
 * English of /about. `path` is the page's path without the locale prefix and
 * without a query ("" for the home page); the canonical is that path in the
 * page's own language, and both languages are listed, Chinese as the default
 * (it is the unprefixed one).
 */
export function alternates(locale: string, path: string): Metadata["alternates"] {
  const zh = `${SITE_URL}${path || "/"}`;
  const en = `${SITE_URL}/en${path}`;
  return {
    canonical: locale === routing.defaultLocale ? zh : en,
    languages: { "zh-TW": zh, en, "x-default": zh },
  };
}
