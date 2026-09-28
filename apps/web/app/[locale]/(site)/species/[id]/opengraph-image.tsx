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
import { speciesNames } from "@/lib/speciesNames";
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

// The team's palette: forest ground, ivory type, the report orange as the one
// accent. Measured on #183D32: ivory 10.98:1, the pale green 7.4:1, the muted
// green 4.9:1, and the orange 3.3:1, which is why the orange is only ever set
// at 34px and above, where 3:1 is the bar.
const FOREST_900 = "#183D32";
const IVORY = "#F7F5ED";
const PALE = "#CFE0D3";
const MUTED = "#A3BDAE";
const ORANGE = "#D96B3B";
const ROSE = "#F4A3AE";

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
  // Both names, the page's language first (lib/speciesNames.ts).
  const names = s ? speciesNames(s, locale) : null;
  // TaiCOL's endemic flag on a subspecies means an endemic SUBSPECIES:
  // 白頭翁's Taiwan form is endemic, the bird is not.
  const subspecific = s?.rank !== undefined && s?.rank !== null && s.rank !== "Species";

  // What the card would say with a Chinese font available.
  const wanted = {
    headline: names ? names.primary.text : binomial,
    other: names?.other?.text ?? null,
    scientific: names?.scientific?.text ?? null,
    countLabel:
      count !== null
        ? zh
          ? `${count.toLocaleString("en-US")} 筆紀錄`
          : `${count.toLocaleString("en-US")} records`
        : null,
    protectedLabel: zh ? "保育類" : "Protected",
    endemicLabel: subspecific
      ? zh ? "臺灣特有亞種" : "Endemic subspecies"
      : zh ? "臺灣特有種" : "Endemic to Taiwan",
    footer: zh
      ? "臺灣路殺與野生動物紀錄"
      : "Roadkill and wildlife records from Taiwan",
  };

  // One subset covering every character actually printed, Latin included — a
  // font that lacks the Latin glyphs would leave the binomial blank.
  const font = await subsetFont(
    [
      wanted.headline,
      wanted.other ?? "",
      wanted.scientific ?? "",
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
        other: null,
        scientific: null,
        countLabel:
          count !== null ? `${count.toLocaleString("en-US")} records` : null,
        protectedLabel: "Protected",
        endemicLabel: subspecific ? "Endemic subspecies" : "Endemic to Taiwan",
        footer: "Roadkill and wildlife records from Taiwan",
      };

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: FOREST_900,
        padding: "68px 80px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <img src={BADGE} width={62} height={62} alt="" />
        <div
          style={{
            fontSize: 25,
            letterSpacing: "0.26em",
            color: MUTED,
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
            color: IVORY,
          }}
        >
          {card.headline}
        </div>
        {(card.other || card.scientific) && (
          // Two children, so it declares display (satori's rule), and each
          // name is its own node so only the binomial is italic.
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 10, fontSize: 34, color: PALE }}>
            {card.other && <div style={{ fontStyle: "normal" }}>{card.other}</div>}
            {card.scientific && <div style={{ fontStyle: "italic" }}>{card.scientific}</div>}
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
            <div style={{ fontSize: 34, color: ORANGE }}>{card.countLabel}</div>
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
                color: PALE,
                border: `1px solid ${MUTED}`,
                borderRadius: 999,
                padding: "6px 18px",
              }}
            >
              {card.endemicLabel}
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 22, color: MUTED }}>{card.footer}</div>
    </div>,
    font ? { ...size, fonts: [font] } : size,
  );
}
