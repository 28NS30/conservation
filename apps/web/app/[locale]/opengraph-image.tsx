import { ImageResponse } from "next/og";

/**
 * The card a shared link shows.
 *
 * There was none, so every link posted to LINE, Threads or Facebook — which is
 * how a citizen-science project actually spreads in Taiwan — rendered as a bare
 * URL with no image at all.
 *
 * NO CHINESE TEXT IN THE IMAGE, deliberately. Satori ships no CJK glyphs, so
 * 生態守望計畫 would render as tofu boxes unless a font were embedded, and the
 * only CJK font on this machine is Apple's STHeiti, which cannot be
 * redistributed. That costs nothing here: the preview's *text* comes from the
 * HTML title and description, which are already Chinese. The image carries the
 * mark and the Latin line, which is exactly what the badge does.
 *
 * Everything is drawn with flexbox and inline styles because that is all satori
 * supports — no grid, no external stylesheet, no Tailwind classes.
 */
export const alt = "Project EcoWatch — Taiwan";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BARK_950 = "#0b1410";
const BARK_800 = "#1a3125";
const PARCHMENT_50 = "#f6efe0";
const PARCHMENT_200 = "#d8cbb0";
const PARCHMENT_400 = "#9d9179";
const SCALE = ["#8a6a45", "#a8845c", "#c9a882"];
const EMBER = "#cf7238";

/** The mark, at OG scale. Same geometry as components/brand/Mark.tsx. */
function Mark({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="30" fill={BARK_800} />
      <circle
        cx="32"
        cy="32"
        r="30"
        stroke={PARCHMENT_200}
        strokeWidth="2.5"
        fill="none"
      />
      <circle
        cx="32"
        cy="32"
        r="25.5"
        stroke={PARCHMENT_200}
        strokeOpacity="0.3"
        strokeWidth="0.9"
        fill="none"
      />
      <g stroke={BARK_950} strokeWidth="1.1">
        <path
          d="M32 10.5 C40.5 15.25, 40.5 24.75, 32 29.5 C23.5 24.75, 23.5 15.25, 32 10.5 Z"
          fill={SCALE[0]}
        />
        <path
          d="M24 20.5 C32.5 25.25, 32.5 34.75, 24 39.5 C15.5 34.75, 15.5 25.25, 24 20.5 Z
             M40 20.5 C48.5 25.25, 48.5 34.75, 40 39.5 C31.5 34.75, 31.5 25.25, 40 20.5 Z"
          fill={SCALE[1]}
        />
        <path
          d="M16 30.5 C24.5 35.25, 24.5 44.75, 16 49.5 C7.5 44.75, 7.5 35.25, 16 30.5 Z
             M32 30.5 C40.5 35.25, 40.5 44.75, 32 49.5 C23.5 44.75, 23.5 35.25, 32 30.5 Z
             M48 30.5 C56.5 35.25, 56.5 44.75, 48 49.5 C39.5 44.75, 39.5 35.25, 48 30.5 Z"
          fill={SCALE[2]}
        />
      </g>
      <path
        d="M14 50.5 h9 M28 50.5 h8 M42 50.5 h8"
        stroke={PARCHMENT_200}
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="4.6" cy="32" r="2.1" fill={EMBER} />
      <circle cx="59.4" cy="32" r="2.1" fill={EMBER} />
    </svg>
  );
}

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
        <Mark s={430} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <Mark s={104} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 46,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: PARCHMENT_50,
            }}
          >
            PROJECT ECOWATCH
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
