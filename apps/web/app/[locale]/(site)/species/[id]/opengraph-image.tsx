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

/**
 * The share card for one species.
 *
 * These are the links people actually post — "look how many leopard cats are
 * being killed on this road" — so they are worth more than the generic site
 * card, which is what they fell back to.
 *
 * The scientific name carries the card, which solves the CJK problem for free:
 * satori has no Chinese glyphs, but a binomial is Latin by definition. The
 * Chinese common name still reaches the reader through og:title, which is HTML.
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
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const taxonId = parseSpeciesId(id);
  const s = taxonId ? await getSpecies(taxonId) : null;

  const binomial = s?.scientificName ?? "Project EcoWatch";
  // A 座標不開放 taxon reports 0 here even when records exist, so the count is
  // simply omitted rather than stated as zero — see the species page.
  const withheld = s?.sensitivity === "座標不開放";
  const count = s && !withheld ? s.reportCount : null;

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
          PROJECT ECOWATCH
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: binomial.length > 26 ? 62 : 78,
            fontStyle: "italic",
            lineHeight: 1.12,
            color: PARCHMENT_50,
          }}
        >
          {binomial}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginTop: 26,
          }}
        >
          {count !== null && (
            // One text node, not two. Satori refuses any div with more than
            // one child unless it declares display, and `{n} records` is an
            // interpolation plus a literal — which is two.
            <div style={{ fontSize: 34, color: EMBER }}>
              {`${count.toLocaleString("en-US")} records`}
            </div>
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
              Protected
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
              Endemic to Taiwan
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 22, color: PARCHMENT_400 }}>
        Roadkill and wildlife records from Taiwan · open data
      </div>
    </div>,
    size,
  );
}
