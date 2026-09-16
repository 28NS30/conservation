"use client";

import { useEffect } from "react";
import { withBase } from "@/lib/basePath";

/**
 * Registers the service worker so the app opens without a signal, and responds
 * to the Background Sync ping by flushing the queue from the page (where
 * IndexedDB and the Supabase client already live).
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SW_IN_DEV) return;

    void navigator.serviceWorker.register(withBase("/sw.js")).catch(() => {});

    // Imported only when a flush is asked for. A static import put the offline
    // queue — and through it supabase-js — into the chunk every page hydrates
    // with, from the root layout, on the one page that most needs its main
    // thread: /map. On a slow phone MapLibre started loading ~300 ms later for
    // it. Background Sync is rare; paying for it on every page load was not.
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "flush-reports")
        void import("@/lib/offline/flush")
          .then((m) => m.flushQueue())
          .catch(() => {});
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  return null;
}
