import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The badge itself, as a data URI.
 *
 * These cards used to redraw the abstract mark in SVG because satori supports
 * only inline styles and flexbox. That meant the image people saw when a link
 * was shared was the one place the real logo never appeared. Read once at module
 * scope, which is the documented pattern for local assets in an OG route.
 */
const BADGE = `data:image/png;base64,${(
  await readFile(join(process.cwd(), "public", "brand-badge.png"))
).toString("base64")}`;

/**
 * The card a shared link shows.
 *
 * There was none, so every link posted to LINE, Threads or Facebook — which is
 * how a citizen-science project actually spreads in Taiwan — rendered as a bare
 * URL with no image at all.
 *
 * NO CHINESE TEXT IN THE IMAGE, deliberately. Satori ships no CJK glyphs, so
 * 福爾摩沙守望計畫 would render as tofu boxes unless a font were embedded, and the
 * only CJK font on this machine is Apple's STHeiti, which cannot be
 * redistributed. That costs nothing here: the preview's *text* comes from the
 * HTML title and description, which are already Chinese. The image carries the
 * mark and the Latin line, which is exactly what the badge does.
 *
 * Everything is drawn with flexbox and inline styles because that is all satori
 * supports — no grid, no external stylesheet, no Tailwind classes.
 */
export const alt = "Project FormosaWatch — Taiwan";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BARK_950 = "#0b1410";
const PARCHMENT_50 = "#f6efe0";
const PARCHMENT_400 = "#9d9179";
const EMBER = "#cf7238";

export default async function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: BARK_950,
        padding: "72px 80px",
        position: "relative",
      }}
    >
      {/* An oversized mark bleeding off the right edge. space-between was
          stretching three small blocks across 630px and leaving the middle
          empty; this fills it without competing with the text, and makes the
          card unmistakably this project at thumbnail size. */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          right: -110,
          top: 150,
          opacity: 0.13,
        }}
      >
        <img src={BADGE} width={430} height={430} alt="" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <img src={BADGE} width={104} height={104} alt="" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 46,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: PARCHMENT_50,
            }}
          >
            PROJECT FORMOSAWATCH
          </div>
          <div
            style={{
              fontSize: 21,
              letterSpacing: "0.28em",
              color: EMBER,
              marginTop: 10,
            }}
          >
            TAIWAN · CITIZEN SCIENCE
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 40,
            lineHeight: 1.3,
            color: PARCHMENT_50,
            maxWidth: 900,
          }}
        >
          Every life lost on the road deserves a record.
        </div>
        <div style={{ fontSize: 24, color: PARCHMENT_400, marginTop: 18 }}>
          An open map of roadkill, invasive species and environmental reports
        </div>
      </div>

      {/* The ember rule ties the card to the badge's two dots. */}
      <div
        style={{
          display: "flex",
          height: 6,
          width: 180,
          background: EMBER,
          borderRadius: 3,
        }}
      />
    </div>,
    size,
  );
}
