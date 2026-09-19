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
    // A manifest is served once for the whole site, before any locale is known,
    // so it cannot read the catalogues and these two lines are `site.description`
    // in both languages, copied. test/copy-truth.test.mjs keeps them honest.
    name: "福爾摩沙守望計畫 · Project FormosaWatch",
    short_name: "福爾摩沙守望",
    description:
      "臺灣的公開野生動物紀錄地圖，資料來自路殺社（TaiRON），任何人都能通報。An open map of wildlife records for Taiwan, built on TaiRON roadkill data. Anyone can add a report.",
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
