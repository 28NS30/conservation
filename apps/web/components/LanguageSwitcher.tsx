"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, LOCALE_LABELS, type Locale } from "@/i18n/routing";

/**
 * Switches locale while staying on the current page.
 *
 * `usePathname` from i18n/navigation returns the path *without* the locale
 * prefix, so pushing it with a new locale keeps the reader where they were
 * instead of dumping them back on the map.
 */
export default function LanguageSwitcher({ className = "" }: { className?: string }) {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className={`flex items-center gap-0.5 text-[11px] ${className}`}>
      {routing.locales.map((l, i) => (
        <span key={l} className="flex items-center gap-0.5">
          {i > 0 && <span className="text-parchment-500">/</span>}
          <button
            type="button"
            lang={l}
            aria-current={l === locale ? "true" : undefined}
            onClick={() => router.replace(pathname, { locale: l })}
            className={
              l === locale
                ? "font-medium text-parchment-200"
                : "text-parchment-500 transition hover:text-parchment-300"
            }
          >
            {LOCALE_LABELS[l]}
          </button>
        </span>
      ))}
    </div>
  );
}
