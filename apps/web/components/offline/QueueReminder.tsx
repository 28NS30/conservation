"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { countWaiting } from "@/lib/offline/queue";

/**
 * "1 筆通報還沒送出 · 送出", on every page, while a report is waiting on this phone.
 *
 * A saved report only leaves the phone while a report page is open — iOS has
 * no Background Sync — and the banner that sends it is on the report pages
 * and nowhere else. Someone who saved a report on a mountain road and next
 * opened the site at its home page, or at the map, was told nothing: the
 * report sat in the queue until they happened to start another one. This is
 * the way back to it.
 *
 * Not on the report pages, where the banner itself is. Loaded when the
 * browser is idle (QueueReminderLoader), so that the queue's code is not in
 * what /map has to download before it can draw.
 */
export default function QueueReminder() {
  const t = useTranslations("offline");
  const pathname = usePathname();
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    let live = true;
    const count = () =>
      void countWaiting().then((n) => {
        if (live) setWaiting(n);
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") count();
    };
    count();
    window.addEventListener("conservation:queue-changed", count);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      window.removeEventListener("conservation:queue-changed", count);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const onReportPage = pathname === "/report" || pathname.startsWith("/report/");
  if (waiting === 0 || onReportPage) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <Link
        id="queue-reminder"
        href="/report"
        className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-forest-900/25 bg-paper-50 px-4 text-sm font-medium text-forest-900 shadow-md transition hover:bg-paper-100"
      >
        <span>{t("reminder", { count: waiting })}</span>
        <span aria-hidden>·</span>
        <span className="font-semibold underline underline-offset-2">{t("reminderSend")}</span>
      </Link>
    </div>
  );
}
