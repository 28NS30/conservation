"use client";

import { preconnect, preload, preloadModule } from "react-dom";
import { MAPLIBRE_SHARED_URL, MAPLIBRE_URL } from "@/lib/maplibreUrls";
import { OPENFREEMAP_DARK } from "@/lib/basemap";

/**
 * Start fetching what the map needs before the map component asks for it.
 *
 * MapLibre is imported dynamically once the component mounts, and the basemap
 * style is fetched only after that, so without hints both downloads wait for
 * hydration. Measured on production: the map constructed about 80–100 ms sooner
 * on a desktop, and the first tile arrived about half a second sooner on a phone
 * over 4G.
 *
 * A client component on purpose. Called from a server component, React ships
 * these hints in the RSC payload — and every page with a Link to /map
 * prefetches that payload, so every page on the site would start downloading
 * 280 KB of MapLibre and contacting OpenFreeMap. Rendered on the client, they
 * reach only the HTML of /map itself.
 */
export default function MapHints() {
  preloadModule(MAPLIBRE_URL);
  preloadModule(MAPLIBRE_SHARED_URL);
  // The MapTiler branch fetches a different style; hinting OpenFreeMap there
  // would be a wasted connection.
  if (!process.env.NEXT_PUBLIC_MAPTILER_KEY) {
    preconnect("https://tiles.openfreemap.org", { crossOrigin: "anonymous" });
    preload(OPENFREEMAP_DARK, { as: "fetch", crossOrigin: "anonymous" });
  }
  return null;
}
