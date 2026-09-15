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
 * What the colour means — how many, or what kind.
 *
 * A separate axis from the shape above, because they answer different
 * questions: density says where this is happening, type says what is happening
 * there, and the map is asked both. Splitting them keeps six useful views out of
 * two three-item controls instead of one six-item one.
 */
export type MapColour = "density" | "type";
const COLOURS: MapColour[] = ["density", "type"];
const COLOUR_KEY = "conservation.mapColour";

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

/** The same shape as modeStore, for the colour axis. */
const colourStore = {
  listeners: new Set<() => void>(),
  get(): MapColour {
    try {
      const v = window.localStorage.getItem(COLOUR_KEY);
      return v === "type" ? "type" : "density";
    } catch {
      return "density"; // private browsing
    }
  },
  getServer(): MapColour {
    return "density";
  },
  set(c: MapColour) {
    try {
      window.localStorage.setItem(COLOUR_KEY, c);
    } catch {
      // Not persisted, but the in-memory notify below still updates the UI.
    }
    for (const l of colourStore.listeners) l();
  },
  subscribe(l: () => void) {
    colourStore.listeners.add(l);
    window.addEventListener("storage", l);
    return () => {
      colourStore.listeners.delete(l);
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

export function useMapColour(): [MapColour, (c: MapColour) => void] {
  const colour = useSyncExternalStore(
    colourStore.subscribe,
    colourStore.get,
    colourStore.getServer,
  );
  return [colour, colourStore.set];
}

export { MODES, modeStore, COLOURS, colourStore };
