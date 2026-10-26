import { ImageResponse } from "next/og";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The badge itself, as a data URI, read once at module scope as the species
 * card does (species/[id]/opengraph-image.tsx).
 */
const BADGE = `data:image/png;base64,${(
  await readFile(join(process.cwd(), "public", "brand-badge.png"))
).toString("base64")}`;

import { routing } from "@/i18n/routing";
import { formatTaipeiDate } from "@/lib/dates";
import { blurKm, CARD_PHOTO, cardPhoto, publicRecordSummary } from "@/lib/recordMeta";
import { speciesLabel, speciesNames } from "@/lib/speciesNames";
import { subsetFont } from "@/lib/ogFont";

/**
 * The share card for one record.
 *
 * A reporter who had just filed a report and sent the link to a class group
 * on LINE got the site's own badge as the preview, the same picture as every
 * other link to the site, so nothing in the chat said what they had found.
 * This card says it: the animal, the day it was seen on Taiwan's calendar,
 * and which kind of record it is, in the species card's style and with its
 * font subset (lib/ogFont.ts), so 黑眶蟾蜍 is printed as 黑眶蟾蜍.
 *
 * WHAT IT NEVER CARRIES. A map, a coordinate, a place name, the notes or the
 * credit. The summary it is drawn from selects none of them
 * (lib/recordMeta.ts). The record's own photograph appears only on a record
 * shown at its exact location (cardMayShowPhoto), and anything the public
 * view does not hold — a held report, a rejected one, a test, a withheld
 * species, an id nobody issued — gets the same plain card with the site's
 * name, so the card cannot tell a stranger which of those an id is.
 *
 * Rendered per request rather than cached. A record can be renamed to a
 * protected species, which blurs it, or taken down by a moderator, and the
 * card must follow the record as the page does rather than keep the photo it
 * was first drawn with. Link previews are fetched once per share, so the cost
 * is a render per share, not per view.
 */
export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type ImageParams = { locale?: string; id?: string };

/**
 * The card's alt text: what was seen and when, in the page's language, or
 * the site's name for a record that is not public. Partial params at build
 * time, as on the species card; see generateImageMetadata there.
 */
export async function generateImageMetadata({
  params: given,
}: {
  params: ImageParams | Promise<ImageParams> | undefined;
}) {
  const params = await given;
  const asked = params?.locale;
  const known = hasLocale(routing.locales, asked);
  const locale = known ? asked : routing.defaultLocale;
  const zh = locale.startsWith("zh");
  const r = known && params?.id ? await publicRecordSummary(params.id) : null;
  const name = r?.scientificName
    ? speciesLabel({ ...r, scientificName: r.scientificName }, locale)
    : null;
  const date = r ? formatTaipeiDate(r.observedAt, locale, { dateStyle: "long" }) : null;
  return [
    {
      id: "card",
      alt: r
        ? zh
          ? `${name ?? "一筆野生動物紀錄"}，${date} · 福爾摩沙守望計畫`
          : `${name ?? "A wildlife record"}, ${date} · Project FormosaWatch`
        : zh
          ? "福爾摩沙守望計畫的野生動物紀錄"
          : "A wildlife record on Project FormosaWatch",
      size,
      contentType,
    },
  ];
}

// The species card's palette and its measurements on #183D32: ivory 10.98:1,
// the pale green 7.4:1, the muted green 4.9:1, and the orange 3.3:1, which is
// why the orange is only ever set at 34px and above.
const FOREST_900 = "#183D32";
const IVORY = "#F7F5ED";
const PALE = "#CFE0D3";
const MUTED = "#A3BDAE";
const ORANGE = "#D96B3B";
const AMBER = "#F2C66D";

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  // A made-up first segment reaches this route directly (proxy.ts leaves
  // share cards alone): answer it without a database read or a font fetch.
  if (!hasLocale(routing.locales, locale)) return new Response("Not found", { status: 404 });

  const r = await publicRecordSummary(id);

  const categories = await getTranslations({ locale, namespace: "categories" });
  const meta = await getTranslations({ locale, namespace: "recordMeta" });
  const categoriesEn = await getTranslations({ locale: "en", namespace: "categories" });
  const metaEn = await getTranslations({ locale: "en", namespace: "recordMeta" });
  // The kind of record, in the page's language and in English for a card
  // drawn without the font. Literal keys, so test/og-keys.test.mjs checks each.
  const kind = r
    ? {
        roadkill: [categories("roadkill"), categoriesEn("roadkill")],
        injured: [categories("injured"), categoriesEn("injured")],
        invasive: [categories("invasive"), categoriesEn("invasive")],
        sighting: [categories("sighting"), categoriesEn("sighting")],
      }[r.category]
    : null;

  const names = r?.scientificName
    ? speciesNames({ ...r, scientificName: r.scientificName }, locale)
    : null;
  const blurred = r ? blurKm(r.locationPrecision) : null;

  // What the card would say with a Chinese font available.
  const wanted = {
    headline: r ? (names?.primary.text ?? meta("cardUnnamed")) : meta("cardSite"),
    other: names?.other?.text ?? null,
    scientific: names?.scientific?.text ?? null,
    kind: kind?.[0] ?? null,
    date: r ? formatTaipeiDate(r.observedAt, locale, { dateStyle: "long" }) : null,
    blurred: blurred ? meta("cardBlurred", { km: blurred }) : null,
    footer: meta("cardFooter"),
  };

  // One subset covering every character printed, Latin included, fetched
  // while the photograph is (each gives up after a few seconds, and the card
  // is drawn without whichever did not arrive).
  const [font, photo] = await Promise.all([
    subsetFont(
      [
        wanted.headline,
        wanted.other ?? "",
        wanted.scientific ?? "",
        wanted.kind ?? "",
        wanted.date ?? "",
        wanted.blurred ?? "",
        wanted.footer,
        "PROJECT FORMOSAWATCH",
      ].join(""),
    ),
    r ? cardPhoto(id, r) : null,
  ]);

  // Without it, print nothing that needs a glyph satori does not have: the
  // binomial, and the English for everything else.
  const card = font
    ? wanted
    : {
        headline: r
          ? (r.scientificName ?? metaEn("cardUnnamed"))
          : metaEn("cardSite"),
        other: null,
        scientific: null,
        kind: kind?.[1] ?? null,
        date: r ? formatTaipeiDate(r.observedAt, "en-GB", { dateStyle: "long" }) : null,
        blurred: blurred ? metaEn("cardBlurred", { km: blurred }) : null,
        footer: metaEn("cardFooter"),
      };
  const italicHeadline = Boolean(r?.scientificName && card.headline === r.scientificName);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: FOREST_900,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
          padding: photo ? "60px 56px 60px 72px" : "68px 80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <img src={BADGE} width={62} height={62} alt="" />
          <div style={{ fontSize: 25, letterSpacing: "0.26em", color: MUTED }}>
            PROJECT FORMOSAWATCH
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: card.headline.length > (photo ? 16 : 26) ? 58 : 76,
              // Italic is a Latin convention for a binomial and wrong for Hanzi.
              fontStyle: italicHeadline ? "italic" : "normal",
              lineHeight: 1.12,
              color: IVORY,
            }}
          >
            {card.headline}
          </div>
          {(card.other || card.scientific) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, fontSize: 32, color: PALE }}>
              {card.other && <div style={{ fontStyle: "normal" }}>{card.other}</div>}
              {card.scientific && <div style={{ fontStyle: "italic" }}>{card.scientific}</div>}
            </div>
          )}
          {(card.kind || card.date) && (
            // Each a text node of its own: satori refuses a div with more
            // than one child unless it declares display.
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 20, marginTop: 26 }}>
              {card.kind && <div style={{ fontSize: 34, color: ORANGE }}>{card.kind}</div>}
              {card.date && <div style={{ fontSize: 34, color: PALE }}>{card.date}</div>}
            </div>
          )}
          {card.blurred && (
            <div style={{ display: "flex", marginTop: 22 }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 22,
                  color: AMBER,
                  border: `1px solid ${AMBER}`,
                  borderRadius: 999,
                  padding: "6px 18px",
                }}
              >
                {card.blurred}
              </div>
            </div>
          )}
        </div>

        <div style={{ fontSize: 22, color: MUTED }}>{card.footer}</div>
      </div>
      {photo && (
        <img
          src={photo}
          width={CARD_PHOTO.width}
          height={CARD_PHOTO.height}
          alt=""
          style={{ objectFit: "cover" }}
        />
      )}
    </div>,
    font ? { ...size, fonts: [font] } : size,
  );
}
