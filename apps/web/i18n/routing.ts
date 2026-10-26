import { defineRouting } from "next-intl/routing";

/**
 * zh-Hant is the default and lives at the un-prefixed root.
 *
 * The audience is Taiwanese; English is for researchers and international
 * collaborators. `localePrefix: "as-needed"` keeps `/` and `/report` short for
 * the primary audience and puts English at `/en/...`, rather than redirecting
 * every Taiwanese visitor to `/zh-TW`.
 */
export const routing = defineRouting({
  locales: ["zh-TW", "en"],
  defaultLocale: "zh-TW",
  localePrefix: "as-needed",
  // Chinese for everyone unless they choose English, by the language switch or
  // an /en address. With detection on, an English-language browser opening
  // /report was redirected to /en/report, so the team saw the site in English
  // (team feedback, 30 September 2026: "make the default language Chinese
  // since we're in Taiwan").
  localeDetection: false,
  // Nothing reads the NEXT_LOCALE cookie with detection off: the address alone
  // says which language a page is in. Writing it anyway put a Set-Cookie on
  // every page's response, and a response that sets a cookie is one no CDN
  // will share between visitors.
  localeCookie: false,
  // No `Link: <…>; rel="alternate"` response header. It was built from the
  // host the request came in on, so the old preservation-web-one.vercel.app
  // address advertised itself as the page's other-language version. Every
  // page already names both versions, at the canonical address, in its own
  // <head> (lib/alternates.ts).
  alternateLinks: false,
});

export type Locale = (typeof routing.locales)[number];

/** Names shown in the language switcher, each in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-TW": "中文",
  en: "English",
};
