"use client";

import { useEffect, useRef } from "react";

/**
 * Drop the pages this device keeps for offline use when its form is sent.
 *
 * Placed inside the sign-out and delete-account forms. The service worker
 * keeps only public pages now (public/sw.js OFFLINE_PAGES), but those still
 * carry the header of whoever was signed in, and on a shared school computer
 * the next person should start from nothing. Best effort and never blocking:
 * the form posts either way, and without JavaScript it still signs out.
 *
 * Never the report queue: that is IndexedDB, not Cache Storage, and it may
 * hold a report still waiting for signal.
 */
export default function ForgetOfflineCopies() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const forget = () => {
      if (!("caches" in window)) return;
      void caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((k) => k.startsWith("shell-")).map((k) => caches.delete(k))),
        )
        .catch(() => {});
    };
    form.addEventListener("submit", forget);
    return () => form.removeEventListener("submit", forget);
  }, []);
  return <span ref={ref} hidden />;
}
