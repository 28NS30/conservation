import "server-only";

import { cache } from "react";
import type { Category, LocationPrecision } from "@conservation/shared";
import { asPublic, sql } from "@/lib/db";
import { signedPhotoUrl } from "@/lib/supabase/service";

/** A real UUID's shape: 36 dashes passed the old pattern and 500'd on ::uuid. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a record page tells a search engine and a link preview: its title,
 * its description and its share card. Nothing here is more than the page
 * itself shows anybody, and nothing here is a place.
 */
export type PublicRecordSummary = {
  observedAt: string;
  source: string;
  category: Category;
  locationPrecision: LocationPrecision;
  taxonId: number | null;
  scientificName: string | null;
  commonNameZh: string | null;
  commonNameEn: string | null;
  taicolId: string | null;
};

/**
 * One record as the public view has it, or null for anything the public may
 * not see: an id that was never issued, a held or rejected report, a test, a
 * record whose species' coordinates are withheld. `reports_public` as
 * `web_anon` decides that, and every one of them gets the same null, so the
 * title, the description and the card cannot tell a held report from a typo.
 *
 * No coordinate is selected. The precision is, because the description says
 * when a record is blurred and the card decides by it whether the photo may
 * be shown.
 *
 * Memoised per request (React's cache): the page's metadata and its share
 * card's alt text both ask. The card's own route is outside React and reads
 * it again.
 */
export const publicRecordSummary = cache(
  async (id: string): Promise<PublicRecordSummary | null> => {
    if (!UUID.test(id)) return null;
    const [row] = await asPublic(
      (tx) => tx<PublicRecordSummary[]>`
        select rp.observed_at as "observedAt", rp.source, rp.category,
               rp.location_precision as "locationPrecision",
               rp.taxon_id as "taxonId",
               t.scientific_name as "scientificName",
               t.common_name_zh as "commonNameZh",
               t.common_name_en as "commonNameEn",
               t.taicol_id as "taicolId"
          from reports_public rp
          left join taxa t on t.id = rp.taxon_id
         where rp.id = ${id}::uuid`,
    );
    return row ?? null;
  },
);

/** How far a blurred record is moved, in km, or null for an exact one. */
export function blurKm(precision: LocationPrecision): number | null {
  return precision === "coarse_50km" ? 50 : precision === "coarse_10km" ? 10 : null;
}

/**
 * Whether a record's share card may carry the record's own photograph.
 *
 * Only an exact record's. A blurred record is blurred because the animal is
 * protected, rated sensitive or not yet identified, and a photograph shows
 * the place as well as the animal: a ridge line, a shrine, a road sign. The
 * record page has always shown its photos beside a blurred point, inside the
 * page; a card is the version of the record that travels, pasted into group
 * chats nobody here can see, so it shows the least. Published and not a test
 * are already settled by `reports_public`, which the summary was read from.
 *
 * test/record-card.test.mjs holds this, and checks that a blurred record's
 * card comes out the same with a photo as without one.
 */
export function cardMayShowPhoto(r: Pick<PublicRecordSummary, "locationPrecision">): boolean {
  return r.locationPrecision === "exact";
}

/** What a stored photo may be. The report form stores WebP. */
const STORED = /^image\/(webp|jpeg|png)$/;
/** Stored photos are at most 2048px and usually under a megabyte. */
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/** The photograph's place on the card: the right-hand side, full height. */
export const CARD_PHOTO = { width: 460, height: 630 } as const;

/**
 * The photo as a JPEG the size it is drawn at.
 *
 * Satori draws JPEG and PNG and silently leaves a WebP blank, and every
 * stored photo is WebP, so a card handed the stored file showed an empty
 * panel. sharp, which Next installs for its own image optimiser, converts
 * it, and at the card's size it is a few tens of kilobytes rather than the
 * stored megabyte, which is also what keeps drawing the card quick. Without
 * sharp a JPEG or PNG is drawn as stored and a WebP is left out.
 */
async function drawable(bytes: ArrayBuffer, type: string): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp(Buffer.from(bytes))
      .rotate()
      .resize(CARD_PHOTO.width, CARD_PHOTO.height, { fit: "cover" })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return type === "image/webp"
      ? null
      : `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  }
}

/**
 * The record's first photograph, as a JPEG data URI the card can draw, or
 * null.
 *
 * Asked only for a record cardMayShowPhoto() allows, and the path is read on
 * the server's own connection only after that, as the record page does: the
 * public role cannot read report_photos, and the summary has already shown
 * the record is public and exact. The URL is signed here, for a minute, and
 * the bytes fetched here; the signed URL never reaches the card, the page or
 * the crawler. A fetch of our own rather than handing satori the URL, because
 * satori refuses addresses on a private network, which is where local
 * Storage lives, and because this way a slow Storage costs at most three
 * seconds and a card without a photo, never a failed card.
 */
export async function cardPhoto(
  id: string,
  summary: PublicRecordSummary,
): Promise<string | null> {
  if (!cardMayShowPhoto(summary)) return null;
  try {
    const [photo] = await sql<{ storage_path: string }[]>`
      select storage_path from report_photos
       where report_id = ${id}::uuid
       order by created_at, id
       limit 1`;
    if (!photo) return null;
    const url = await signedPhotoUrl(photo.storage_path, 60);
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!res.ok || !STORED.test(type)) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) return null;
    return await drawable(bytes, type);
  } catch {
    return null;
  }
}
