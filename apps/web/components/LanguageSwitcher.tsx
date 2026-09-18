"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, LOCALE_LABELS, type Locale } from "@/i18n/routing";

/**
 * Switches locale while staying on the current page — and on the current view.
 *
 * `usePathname` from i18n/navigation returns the path *without* the locale
 * prefix, so replacing it with a new locale keeps the reader where they were
 * instead of dumping them back on the map. But a path is not the whole address:
 * the map, the species directory and the report list all keep what the reader
 * chose in the query string, and replacing the bare pathname threw all of it
 * away. Switching language on a filtered list or a map panned to one valley
 * silently returned an unfiltered list and the whole island.
 *
 * The query is read from `location` at click time rather than through
 * `useSearchParams`. Two reasons, and either alone would decide it: the map
 * writes its view with `history.replaceState`, which the hook never sees, and
 * `useSearchParams` opts its whole subtree out of static rendering — this sits
 * in the header, which nothing wraps in <Suspense>, so the home page would stop
 * being a static build.
 *
 * Colours are inherited rather than named. This sits in three different places —
 * the paper header, the dark strip above the map, and the transparent bar
 * floating over the home page's map — and any fixed colour is unreadable in at
 * least one of them. The active locale is distinguished by weight and the
 * inactive one by opacity, both of which work on any ground.
 */
export default function LanguageSwitcher({
  className = "",
}: {
  className?: string;
}) {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  const switchTo = (l: Locale) => {
    // Rendered on the server too, where there is no `location`; the handler only
    // ever runs in the browser, but the guard costs nothing and says so.
    const rest =
      typeof window === "undefined"
        ? ""
        : window.location.search + window.location.hash;
    router.replace(`${pathname}${rest}`, { locale: l });
  };

  return (
    <div className={`flex items-center gap-0.5 text-[11px] ${className}`}>
      {routing.locales.map((l, i) => (
        <span key={l} className="flex items-center gap-0.5">
          {i > 0 && <span className="opacity-40">/</span>}
          <button
            type="button"
            lang={l}
            aria-current={l === locale ? "true" : undefined}
            onClick={() => switchTo(l)}
            // A 22x17 tap target at the bottom of every page. The label is set
            // at 11px by the surrounding chrome and has to stay there, so the
            // box is grown around it instead.
            className={`inline-flex min-h-6 min-w-6 items-center justify-center px-1 ${
              l === locale
                ? "font-medium"
                : "opacity-60 transition hover:opacity-100"
            }`}
          >
            {LOCALE_LABELS[l]}
          </button>
        </span>
      ))}
    </div>
  );
}
