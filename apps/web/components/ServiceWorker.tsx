"use client";

import { useEffect } from "react";
import { flushQueue } from "@/lib/offline/flush";

/**
 * Registers the service worker so the app opens without a signal, and responds
 * to the Background Sync ping by flushing the queue from the page (where
 * IndexedDB and the Supabase client already live).
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SW_IN_DEV) return;

    void navigator.serviceWorker.register("/sw.js").catch(() => {});

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "flush-reports") void flushQueue();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  return null;
}
