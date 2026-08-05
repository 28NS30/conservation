import type { MetadataRoute } from "next";

/**
 * Installable PWA.
 *
 * Not cosmetic: on iOS there is no Background Sync, so a queued report only
 * leaves the device when the user opens the app. An installed icon on the home
 * screen makes "open it again" a natural action, which directly improves how
 * often offline reports actually arrive.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "生態通報地圖 · Taiwan Conservation Map",
    short_name: "生態通報",
    description:
      "台灣路殺、外來入侵種與環境通報的公開熱點地圖。A public heatmap of roadkill, invasive species and environmental reports across Taiwan.",
    start_url: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
