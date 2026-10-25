"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
 *
 * Where it sits. A pill floating at the foot of the screen covers whatever is
 * there, and checked at phone width that was, on /map, the line of data
 * credits under the map — which the licences require to stay visible — and,
 * at the end of every other page, the footer's. So on /map it is not floated
 * at all: it takes a strip of the page's own column, under the map, and the
 * map is that much shorter while a report waits. Elsewhere it floats, and the
 * page gets as much room again at its end, so that its last lines can be
 * scrolled clear of it.
 */
export default function QueueReminder() {
  const t = useTranslations("offline");
  const pathname = usePathname();
  const [waiting, setWaiting] = useState(0);
  /** On /map, the page's column to sit in (see above); elsewhere none. */
  const [dock, setDock] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (pathname !== "/map") {
      const frame = requestAnimationFrame(() => setDock(null));
      return () => cancelAnimationFrame(frame);
    }
    // The page's <main>, found again whenever it is replaced: /map first
    // shows its loading skeleton's <main> (map/loading.tsx), and a strip
    // left in that one went out with it.
    const find = () =>
      setDock((d) => (d?.isConnected ? d : document.querySelector("main")));
    const frame = requestAnimationFrame(find);
    const watch = new MutationObserver(find);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [pathname]);

  // Counted again on every change to the queue on this page, whenever the
  // page comes back into view (another tab may have sent or discarded one),
  // and on every move to another page: discarding the last report on a report
  // page and going on to another left "1 筆通報還沒送出" on all of them.
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
  }, [pathname]);

  const onReportPage = pathname === "/report" || pathname.startsWith("/report/");
  if (waiting === 0 || onReportPage) return null;

  const pill = (
    <Link
      id="queue-reminder"
      href="/report"
      className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-forest-900/25 bg-paper-50 px-4 text-sm font-medium text-forest-900 shadow-md transition hover:bg-paper-100"
    >
      <span>{t("reminder", { count: waiting })}</span>
      <span aria-hidden>·</span>
      <span className="font-semibold underline underline-offset-2">{t("reminderSend")}</span>
    </Link>
  );

  if (dock)
    return createPortal(
      <div className="flex shrink-0 justify-center border-t border-ink-900/10 bg-paper-100 px-4 py-1.5 pb-[calc(env(safe-area-inset-bottom)+0.375rem)]">
        {pill}
      </div>,
      dock,
    );

  return (
    <>
      {/* The room at the end of the page. The colour of the footer it follows. */}
      <div aria-hidden className="h-[calc(env(safe-area-inset-bottom)+4.5rem)] bg-forest-950" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        {pill}
      </div>
    </>
  );
}
