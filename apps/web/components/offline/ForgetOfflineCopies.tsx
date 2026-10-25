"use client";

import { useEffect, useRef } from "react";
import { forgetSent } from "@/lib/offline/sent";
import { forgetDrafts } from "@/lib/offline/drafts";

/**
 * Drop the pages this device keeps for offline use when its form is sent.
 *
 * Placed inside the sign-out and delete-account forms. The service worker
 * keeps only public pages now (public/sw.js OFFLINE_PAGES), but those still
 * carry the header of whoever was signed in, and on a shared school computer
 * the next person should start from nothing. Best effort and never blocking:
 * the form posts either way, and without JavaScript it still signs out.
 *
 * With them go this device's list of the reports it sent (lib/offline/sent.ts),
 * which /me shows to whoever opens it signed out, and any report half filled
 * in (lib/offline/drafts.ts): the next person should not find either.
 *
 * Never the report queue: it may hold a report still waiting for signal, and
 * losing that is worse than leaving it for the next person to send.
 */
export default function ForgetOfflineCopies() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const forget = () => {
      void forgetSent();
      void forgetDrafts();
      if (!("caches" in window)) return;
      void caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => k.startsWith("shell-") || k.startsWith("report-"))
              .map((k) => caches.delete(k)),
          ),
        )
        .catch(() => {});
    };
    form.addEventListener("submit", forget);
    return () => form.removeEventListener("submit", forget);
  }, []);
  return <span ref={ref} hidden />;
}
