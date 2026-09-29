"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { REPORT_PAGE_KEYS } from "@conservation/shared";
import { routing } from "@/i18n/routing";
import { withBase } from "@/lib/basePath";

/** At most this often per language, so a busy reporter is not re-rendering four pages per visit. */
const EVERY_MS = 6 * 3600 * 1000;

/**
 * Makes every report page open without a signal once any one of them has.
 *
 * The service worker caches only what was actually visited (public/sw.js,
 * network-first), so a reporter who had loaded the roadkill page could not
 * open the wildlife page, or the chooser, on a mountain road — the one place
 * the offline queue exists for. This asks the worker to fetch the chooser and
 * all three pages in the reader's language, with the scripts and styles they
 * need, whenever a report page is open and online.
 *
 * These are our own pages; the no-prefetch rule in sw.js is about
 * OpenFreeMap's tiles, whose terms forbid automated collection, and nothing
 * here asks for a tile.
 */
export default function WarmReportPages() {
  const locale = useLocale();

  useEffect(() => {
    if (!("serviceWorker" in navigator) || navigator.onLine === false) return;

    // A convenience, so storage that throws — a private window, blocked site
    // data — just means warming on every visit.
    const key = `conservation:report-pages-warmed:${locale}`;
    try {
      const last = Number(localStorage.getItem(key) ?? 0);
      if (Date.now() - last < EVERY_MS) return;
    } catch {
      /* warm anyway */
    }

    const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
    const paths = ["", ...REPORT_PAGE_KEYS.map((k) => `/${k}`)].map((k) =>
      withBase(`${prefix}/report${k}`),
    );

    let cancelled = false;
    void navigator.serviceWorker.ready
      .then((reg) => {
        if (cancelled || !reg.active) return;
        reg.active.postMessage({ type: "warm-report-pages", paths });
        try {
          localStorage.setItem(key, String(Date.now()));
        } catch {
          /* see above */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return null;
}
