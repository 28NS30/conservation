"use client";

import { useEffect, useState, type ComponentType } from "react";

/**
 * QueueReminder, fetched once the browser has nothing better to do.
 *
 * It is on every page, from the root layout, and it reads the offline queue,
 * which brings IndexedDB code with it. Imported statically it would be in the
 * chunk every page hydrates with — /map included, the page that most needs
 * its first second for MapLibre (the same reason components/ServiceWorker.tsx
 * imports the flush only when asked). So this is all that ships up front, and
 * the reminder follows when the page is idle, or after a few seconds at most.
 * A reminder a moment late costs nothing; a map a moment late is the map.
 */
export default function QueueReminderLoader() {
  const [Reminder, setReminder] = useState<ComponentType | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      void import("./QueueReminder")
        .then((m) => {
          if (live) setReminder(() => m.default);
        })
        // Offline on a page whose chunks were never kept: no reminder.
        .catch(() => {});
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(load, { timeout: 4000 })
      : window.setTimeout(load, 2000);
    return () => {
      live = false;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);

  return Reminder ? <Reminder /> : null;
}
