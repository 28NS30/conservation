"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Whether the browser believes it has a connection, kept current.
 *
 * `navigator.onLine === false` is reliable — the device has no network at
 * all — and `true` only means "some network", which is why nothing here
 * treats it as proof that a send will work: the report pages still time a
 * send out and offer to save instead (lib/report/sendState.ts).
 *
 * The server has no navigator, and a page rendered there is for a reader with
 * a connection, so the server's answer is `true`.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
