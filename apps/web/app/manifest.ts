import type { MetadataRoute } from "next";
import { withBase } from "@/lib/basePath";

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
    name: "生態守望計畫 · Project EcoWatch",
    short_name: "生態守望",
    description:
      "台灣路殺、外來入侵種與環境通報的公開熱點地圖。A public heatmap of roadkill, invasive species and environmental reports across Taiwan.",
    start_url: withBase("/"),
    display: "standalone",
    background_color: "#0b1410",
    theme_color: "#0b1410",
    icons: [
      {
        src: withBase("/brand-badge.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: withBase("/brand-badge.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
