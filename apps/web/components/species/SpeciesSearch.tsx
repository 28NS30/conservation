"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

/**
 * Search box for the species directory.
 *
 * Debounced because a bare substring query over 66k taxa is a sequential scan
 * for short Chinese input — ~18 ms, which is fine per keystroke-pause but not
 * per keystroke. See 0005_taxa_search.sql for why that scan is deliberate.
 *
 * The URL is rebuilt from the whole state, not from `q` alone. Rebuilding it
 * from the query string dropped `filter`, so typing into the box while
 * "Invasive species" was chosen silently widened the search to all 66,201 taxa
 * while the chip stayed drawn as if it were still on. The filter arrives as a
 * prop because the page has already validated it against its own list — the
 * box must not be the second place that decides what a legal filter is.
 */
export default function SpeciesSearch({
  initialQuery,
  filter,
}: {
  initialQuery: string;
  filter: string;
}) {
  const t = useTranslations("species");
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const first = useRef(true);

  useEffect(() => {
    // Don't re-navigate on mount with the value the server already rendered.
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => {
      const q = value.trim();
      // No `page`: a new search is a new result set, and keeping the old page
      // number lands the reader past the end of it.
      router.replace({
        pathname: "/species",
        query: { ...(q ? { q } : {}), filter },
      });
    }, 250);
    return () => clearTimeout(id);
  }, [value, filter, router]);

  return (
    <label className="block">
      <span className="sr-only">{t("searchLabel")}</span>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("searchPlaceholder")}
        className="w-full rounded-lg border border-ink-900/12 bg-paper-100/70 px-3 py-2 text-sm text-ink-800 placeholder:text-ink-500"
      />
    </label>
  );
}
