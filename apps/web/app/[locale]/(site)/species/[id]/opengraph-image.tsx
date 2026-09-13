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

import { getSpecies, parseSpeciesId } from "@/lib/species";
import { subsetFont } from "@/lib/ogFont";

/**
 * The share card for one species.
 *
 * These are the links people actually post — "look how many leopard cats are
 * being killed on this road" — so they are worth more than the generic site
 * card, which is what they fell back to.
 *
 * It used to lead with the scientific name because satori has no Chinese glyphs
 * and a binomial is Latin by definition. That was true and it meant the card a
 * Taiwanese reader posted to LINE said "Prionailurus bengalensis" rather than
 * 石虎. The name now leads in the language of the page, on a font subset fetched
 * for exactly the characters printed — see lib/ogFont.ts.
 *
 * If that fetch fails the card falls back to Latin only, because a link preview
 * must never be the reason a request errors.
 */
export const alt = "Species record";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BARK_950 = "#0b1410";
const PARCHMENT_50 = "#f6efe0";
const PARCHMENT_200 = "#d8cbb0";
const PARCHMENT_400 = "#9d9179";
const EMBER = "#cf7238";
const ROSE = "#fb7185";

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const taxonId = parseSpeciesId(id);
  const s = taxonId ? await getSpecies(taxonId) : null;

  const binomial = s?.scientificName ?? "Project FormosaWatch";
  // A 座標不開放 taxon reports 0 here even when records exist, so the count is
  // simply omitted rather than stated as zero — see the species page.
  const withheld = s?.sensitivity === "座標不開放";
  const count = s && !withheld ? s.reportCount : null;

  const zh = locale.startsWith("zh");
  const zhName = s?.commonNameZh ?? null;

  // What the card would say with a Chinese font available.
  const wanted = {
    headline: zh && zhName ? zhName : binomial,
    secondary: zh && zhName ? binomial : zhName,
    countLabel:
      count !== null
        ? zh
          ? `${count.toLocaleString("en-US")} 筆紀錄`
          : `${count.toLocaleString("en-US")} records`
        : null,
    protectedLabel: zh ? "保育類" : "Protected",
    endemicLabel: zh ? "台灣特有種" : "Endemic to Taiwan",
    footer: zh
      ? "台灣路殺與野生動物紀錄 · 開放資料"
      : "Roadkill and wildlife records from Taiwan · open data",
  };

  // One subset covering every character actually printed, Latin included — a
  // font that lacks the Latin glyphs would leave the binomial blank.
  const font = await subsetFont(
    [
      wanted.headline,
      wanted.secondary ?? "",
      wanted.countLabel ?? "",
      wanted.protectedLabel,
      wanted.endemicLabel,
      wanted.footer,
      "PROJECT FORMOSAWATCH",
    ].join(""),
  );

  // Without it, print nothing that needs a glyph satori does not have.
  const card = font
    ? wanted
    : {
        headline: binomial,
        secondary: null,
        countLabel:
          count !== null ? `${count.toLocaleString("en-US")} records` : null,
        protectedLabel: "Protected",
        endemicLabel: "Endemic to Taiwan",
        footer: "Roadkill and wildlife records from Taiwan · open data",
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
        padding: "68px 80px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <img src={BADGE} width={62} height={62} alt="" />
        <div
          style={{
            fontSize: 25,
            letterSpacing: "0.26em",
            color: PARCHMENT_400,
          }}
        >
          PROJECT FORMOSAWATCH
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: card.headline.length > 26 ? 62 : 78,
            // Italic is a Latin convention for a binomial and wrong for Hanzi.
            fontStyle: card.headline === binomial ? "italic" : "normal",
            lineHeight: 1.12,
            color: PARCHMENT_50,
          }}
        >
          {card.headline}
        </div>
        {card.secondary && (
          <div
            style={{
              fontSize: 34,
              fontStyle: card.secondary === binomial ? "italic" : "normal",
              marginTop: 10,
              color: PARCHMENT_200,
            }}
          >
            {card.secondary}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginTop: 26,
          }}
        >
          {card.countLabel && (
            // One text node, not two. Satori refuses any div with more than
            // one child unless it declares display, and `{n} records` is an
            // interpolation plus a literal — which is two.
            <div style={{ fontSize: 34, color: EMBER }}>{card.countLabel}</div>
          )}
          {s?.protectedStatus && (
            <div
              style={{
                display: "flex",
                fontSize: 22,
                color: ROSE,
                border: `1px solid ${ROSE}`,
                borderRadius: 999,
                padding: "6px 18px",
              }}
            >
              {card.protectedLabel}
            </div>
          )}
          {s?.isEndemic && (
            <div
              style={{
                display: "flex",
                fontSize: 22,
                color: PARCHMENT_200,
                border: `1px solid ${PARCHMENT_400}`,
                borderRadius: 999,
                padding: "6px 18px",
              }}
            >
              {card.endemicLabel}
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 22, color: PARCHMENT_400 }}>{card.footer}</div>
    </div>,
    font ? { ...size, fonts: [font] } : size,
  );
}
