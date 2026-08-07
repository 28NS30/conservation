"use client";

import { useSyncExternalStore } from "react";

/**
 * The display-mode preference, shared by every map that shows report density.
 *
 * Lifted out of HeatmapView so the species map can offer the same three views
 * from the same store: pick dots on /map and the species pages are dots too.
 * One key in localStorage, one vocabulary, one place to change any of it.
 */
export type MapMode = "heat" | "bins" | "dots";
const MODES: MapMode[] = ["heat", "bins", "dots"];
const MODE_KEY = "conservation.mapMode";

/**
 * The bins/dots preference, held in localStorage and read through
 * useSyncExternalStore.
 *
 * Two simpler approaches both fail. Reading localStorage in a `useState`
 * initialiser also runs during hydration, where the server could not have known
 * the value, so React reports a hydration mismatch and refuses to patch it up.
 * Restoring it in an effect instead means calling setState synchronously in an
 * effect body, which cascades renders. useSyncExternalStore is the intended tool:
 * it renders the server snapshot during hydration and swaps to the client
 * snapshot immediately afterwards, with no mismatch and no cascade.
 *
 * The `storage` event subscription is a small bonus — flipping the toggle in one
 * tab updates any others.
 */
const modeStore = {
  listeners: new Set<() => void>(),
  get(): MapMode {
    try {
      const v = window.localStorage.getItem(MODE_KEY);
      return v === "dots" || v === "bins" || v === "heat" ? v : "dots";
    } catch {
      return "dots"; // private browsing
    }
  },
  /** The server has no preference to read, so it always renders the default. */
  getServer(): MapMode {
    return "dots";
  },
  set(m: MapMode) {
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      // Not persisted, but the in-memory notify below still updates the UI.
    }
    for (const l of modeStore.listeners) l();
  },
  subscribe(l: () => void) {
    modeStore.listeners.add(l);
    window.addEventListener("storage", l);
    return () => {
      modeStore.listeners.delete(l);
      window.removeEventListener("storage", l);
    };
  },
};

/** Subscribe to the shared preference. Returns the current mode and a setter. */
export function useMapMode(): [MapMode, (m: MapMode) => void] {
  const mode = useSyncExternalStore(
    modeStore.subscribe,
    modeStore.get,
    modeStore.getServer,
  );
  return [mode, modeStore.set];
}

export { MODES, modeStore };
