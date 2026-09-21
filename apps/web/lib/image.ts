import exifr from "exifr";
import { IMAGE_MAX_EDGE, IMAGE_WEBP_QUALITY } from "@conservation/shared";
import { parseExifDateTime } from "./exifTime";

export type PreparedPhoto = {
  /** Downscaled, re-encoded, metadata-free image ready to upload. */
  blob: Blob;
  width: number;
  height: number;
  /** GPS from the original EXIF, if present. A *suggestion* only — never applied silently. */
  gps: { lat: number; lng: number } | null;
  /**
   * When the photograph was taken, if EXIF says and the reading is credible.
   *
   * Unlike `gps` this IS applied rather than offered: a reporter who has just
   * taken a photograph of an animal is telling us when they saw it, and asking
   * them to confirm the time on their own photo is a question with one answer.
   * The Send screen shows which time it is using and lets them change it.
   */
  takenAt: Date | null;
};

/**
 * Read EXIF GPS from the original file.
 *
 * Must run before `stripAndDownscale`, which destroys all metadata. We surface the
 * coordinate as a suggestion rather than applying it, because the photo may have
 * been taken somewhere other than where it is being reported.
 */
async function readGps(file: File): Promise<{ lat: number; lng: number } | null> {
  try {
    const gps = await exifr.gps(file);
    if (!gps || typeof gps.latitude !== "number" || typeof gps.longitude !== "number") return null;
    return { lat: gps.latitude, lng: gps.longitude };
  } catch {
    return null; // No EXIF, or an unparseable container. Not an error worth surfacing.
  }
}

/**
 * Read the capture time from the original file.
 *
 * `reviveValues: false` on purpose. Left on, exifr hands back a `Date` it has
 * already decided the timezone of, and EXIF's `DateTimeOriginal` carries no
 * timezone to decide — so the library would be making the choice that decides
 * what hour a record is filed under, silently, in a dependency. Off, we get the
 * raw "2026:09:20 07:32:11" and `parseExifDateTime` makes that choice where it
 * can be read and tested.
 *
 * Must run before `stripAndDownscale`, for the same reason `readGps` must.
 */
async function readTakenAt(file: File): Promise<Date | null> {
  try {
    const tags = await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate", "OffsetTimeOriginal"],
      reviveValues: false,
    });
    if (!tags) return null;
    // DateTimeOriginal is when the shutter fired; CreateDate is when the file
    // was written, which on a camera is the same instant and on a re-saved copy
    // is not. Prefer the first and fall back rather than lose the reading.
    return parseExifDateTime(
      tags.DateTimeOriginal ?? tags.CreateDate,
      tags.OffsetTimeOriginal,
      new Date(),
    );
  } catch {
    return null; // No EXIF, or an unparseable container. Not worth surfacing.
  }
}

/**
 * Downscale to IMAGE_MAX_EDGE and re-encode as WebP.
 *
 * The canvas round-trip is both the compression step and the metadata-stripping
 * step: a canvas has no concept of EXIF, so nothing survives it. That matters
 * beyond privacy — a 3–8 MB phone original becomes ~250 KB, which is the
 * difference between a submission succeeding and failing on mountain 4G.
 */
async function stripAndDownscale(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  // `imageOrientation: "from-image"` applies the EXIF rotation while decoding.
  // Without it, portrait phone photos upload sideways — the orientation tag is
  // discarded by the re-encode, so it has to be baked into the pixels here.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", IMAGE_WEBP_QUALITY),
  );
  if (!blob) throw new Error("image encoding failed");

  return { blob, width, height };
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  // Both metadata reads first, and both before the canvas: the re-encode is
  // what strips EXIF, so anything not read by here is gone.
  const [gps, takenAt] = await Promise.all([readGps(file), readTakenAt(file)]);
  const { blob, width, height } = await stripAndDownscale(file);
  return { blob, width, height, gps, takenAt };
}
