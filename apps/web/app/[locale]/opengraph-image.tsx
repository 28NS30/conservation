import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { subsetFont } from "@/lib/ogFont";
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
 * The Chinese name now appears on the Chinese card. Satori ships no CJK glyphs,
 * and the fix used to be "do not print any" — the image carried the mark and the
 * Latin line while the Chinese reached the reader only through the HTML title.
 * Embedding a CJK font is the wrong fix (megabytes, for perhaps thirty glyphs);
 * lib/ogFont.ts fetches a subset covering exactly the characters printed, about
 * four kilobytes. If that fetch fails the card falls back to the Latin-only
 * version below, which is what it has always been.
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

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const zh = locale.startsWith("zh");
  const t = await getTranslations({ locale, namespace: "home" });
  const site = await getTranslations({ locale, namespace: "site" });

  // Copy comes from the catalogues so the card cannot drift from the page.
  const wanted = {
    name: zh ? site("title") : "PROJECT FORMOSAWATCH",
    latin: zh ? "PROJECT FORMOSAWATCH" : null,
    eyebrow: zh ? site("tagline") : "TAIWAN · CITIZEN SCIENCE",
    headline: t("headline"),
    sub: site("description"),
  };

  const font = await subsetFont(
    Object.values(wanted).filter(Boolean).join(""),
    700,
  );

  const card = font
    ? wanted
    : {
        name: "PROJECT FORMOSAWATCH",
        latin: null,
        eyebrow: "TAIWAN · CITIZEN SCIENCE",
        headline: "Every life lost on the road deserves a record.",
        sub: "An open map of wildlife records for Taiwan",
      };

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
              // Hanzi at this size do not need the tracking the Latin line does.
              letterSpacing: card.latin ? "0.12em" : "0.18em",
              color: PARCHMENT_50,
            }}
          >
            {card.name}
          </div>
          {card.latin && (
            <div
              style={{
                fontSize: 20,
                letterSpacing: "0.26em",
                color: PARCHMENT_400,
                marginTop: 8,
              }}
            >
              {card.latin}
            </div>
          )}
          <div
            style={{
              fontSize: 21,
              letterSpacing: "0.28em",
              color: EMBER,
              marginTop: 10,
            }}
          >
            {card.eyebrow}
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
          {card.headline}
        </div>
        <div style={{ fontSize: 24, color: PARCHMENT_400, marginTop: 18 }}>
          {card.sub}
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
    font ? { ...size, fonts: [font] } : size,
  );
}
