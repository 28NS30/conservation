import { ImageResponse } from "next/og";
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
const BARK_800 = "#1a3125";
const PARCHMENT_50 = "#f6efe0";
const PARCHMENT_200 = "#d8cbb0";
const PARCHMENT_400 = "#9d9179";
const SCALE = ["#8a6a45", "#a8845c", "#c9a882"];
const EMBER = "#cf7238";
const ROSE = "#fb7185";

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
      <circle cx="4.6" cy="32" r="2.1" fill={EMBER} />
      <circle cx="59.4" cy="32" r="2.1" fill={EMBER} />
    </svg>
  );
}

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
        <Mark s={62} />
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
