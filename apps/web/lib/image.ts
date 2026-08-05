import exifr from "exifr";
import { IMAGE_MAX_EDGE, IMAGE_WEBP_QUALITY } from "@conservation/shared";

export type PreparedPhoto = {
  /** Downscaled, re-encoded, metadata-free image ready to upload. */
  blob: Blob;
  width: number;
  height: number;
  /** GPS from the original EXIF, if present. A *suggestion* only — never applied silently. */
  gps: { lat: number; lng: number } | null;
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
  const gps = await readGps(file);
  const { blob, width, height } = await stripAndDownscale(file);
  return { blob, width, height, gps };
}
