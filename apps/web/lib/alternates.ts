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

/**
 * The path a paged list gives alternates(): the page it is on.
 *
 * Page 2 of the records is not page 1. Naming page 1 as every page's
 * canonical tells a search engine that pages 2 onward are copies of it, so
 * it drops them and with them the only links to most records and species;
 * each page of a sequence is its own canonical instead. A filtered view
 * (?filter=, ?taxonId=, a date range) still names the unfiltered list, page
 * and all, as it always has: it is a view of that list, not a page of its
 * own. `page=1` and anything that is not a whole number above 1 is page 1.
 */
export function pagedPath(
  path: string,
  params: Record<string, string | string[] | undefined>,
): string {
  const given = Object.keys(params).filter((k) => params[k] !== undefined);
  if (given.some((k) => k !== "page")) return path;
  const raw = params.page;
  const n = Math.floor(Number(Array.isArray(raw) ? raw[0] : raw));
  return Number.isFinite(n) && n >= 2 ? `${path}?page=${n}` : path;
}
