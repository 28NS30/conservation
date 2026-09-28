import { routing } from "@/i18n/routing";

/**
 * A path as the browser shows it: `/map` in Chinese, `/en/map` in English.
 *
 * `next` has to be the address bar's path, not the router's. The callback and
 * the code form hand it straight to the browser, outside next-intl, so a
 * locale-less `/map` would land an English reader on the Chinese page.
 */
export function browserPath(locale: string, path: string): string {
  if (locale === routing.defaultLocale) return path;
  return `/${locale}${path === "/" ? "" : path}`;
}

/** The sign-in link's href object, returning to `path` (in `locale`) afterwards. */
export function signInHref(locale: string, path: string) {
  return { pathname: "/login", query: { next: browserPath(locale, path) } } as const;
}
