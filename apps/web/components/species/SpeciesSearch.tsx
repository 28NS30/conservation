"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";

/**
 * Search box for the species directory.
 *
 * Debounced because a bare substring query over 66k taxa is a sequential scan
 * for short Chinese input — ~18 ms, which is fine per keystroke-pause but not
 * per keystroke. See 0005_taxa_search.sql for why that scan is deliberate.
 */
export default function SpeciesSearch({ initialQuery }: { initialQuery: string }) {
  const t = useTranslations("species");
  const router = useRouter();
  const pathname = usePathname();
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
      router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname);
    }, 250);
    return () => clearTimeout(id);
  }, [value, pathname, router]);

  return (
    <label className="block">
      <span className="sr-only">{t("searchLabel")}</span>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("searchPlaceholder")}
        className="w-full rounded-lg border border-parchment-200/15 bg-bark-900/70 px-3 py-2 text-sm text-parchment-100 placeholder:text-parchment-500"
      />
    </label>
  );
}
