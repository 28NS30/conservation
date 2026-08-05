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
});

export type Locale = (typeof routing.locales)[number];

/** Names shown in the language switcher, each in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-TW": "中文",
  en: "English",
};
