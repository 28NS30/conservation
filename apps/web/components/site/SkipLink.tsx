import { getTranslations } from "next-intl/server";

/** Where the skip link goes: the wrapper around each page's own <main>. */
export const MAIN_CONTENT_ID = "main-content";

/**
 * "Skip to main content", the first thing Tab reaches on every page under the
 * site layout.
 *
 * The header comes first on every page, and on a phone it is two rows: the
 * wordmark, the report menu, five links and the language switch. A keyboard
 * or switch user went through all of them on every page before reaching the
 * page itself, and a report form opened from LINE starts with the header too
 * (WCAG 2.4.1). Hidden until it has focus, then drawn over the header's
 * corner, where Tab has just put the reader's eyes.
 *
 * A plain fragment link, so it works before any script has run.
 */
export default async function SkipLink() {
  const t = await getTranslations("nav");
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-lg focus:bg-paper-50 focus:px-4 focus:text-base focus:font-semibold focus:text-forest-900 focus:shadow-lg"
    >
      {t("skipToContent")}
    </a>
  );
}
