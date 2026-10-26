import {
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_EDGE,
  IMAGE_WEBP_QUALITY,
  MAX_UPLOAD_BYTES,
} from "@conservation/shared";

/**
 * How a photograph is written for the bucket, in one place for the form
 * (lib/image.ts) and for the offline queue, which has photographs an older
 * build wrote. Canvas only, no EXIF reader: the queue banner is on the report
 * chooser too, and has no use for one.
 */

/** Lower JPEG qualities, tried in turn, for a photograph still over MAX_UPLOAD_BYTES. */
const SMALLER_QUALITIES = [0.7, 0.55];

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * A canvas as the bucket takes it: WebP where the browser can write WebP,
 * JPEG where it cannot.
 *
 * Safari cannot, nor can any browser on an iPhone, all of which are WebKit:
 * WebKit encodes a canvas with Apple's ImageIO, which writes no WebP (checked
 * on macOS 26.5, 26 October 2026; test/fixtures/imageio-canvas.swift), and
 * toBlob answers a type it cannot write with a PNG, as the standard says. So
 * every iPhone sent a lossless PNG of a 2048 px photograph, several megabytes
 * where the WebP is a few hundred KB, and one over the bucket's limit was
 * refused. The blob's own type says which it got; anything but WebP is
 * written again as JPEG at IMAGE_JPEG_QUALITY, about a megabyte, and at lower
 * qualities if it is still over MAX_UPLOAD_BYTES.
 *
 * ImageIO puts an Exif block of its own into that JPEG, the colour space and
 * the pixel dimensions and nothing else. The report route allows exactly
 * those tags (lib/report/photoMetadata.ts).
 */
export async function encodePhoto(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", IMAGE_WEBP_QUALITY);
  if (webp?.type === "image/webp" && webp.size <= MAX_UPLOAD_BYTES) return webp;
  let smallest: Blob | null = null;
  for (const quality of [IMAGE_JPEG_QUALITY, ...SMALLER_QUALITIES]) {
    const jpeg = await toBlob(canvas, "image/jpeg", quality);
    if (!jpeg) continue;
    if (jpeg.size <= MAX_UPLOAD_BYTES) return jpeg;
    smallest = jpeg;
  }
  // Still too big at the lowest quality: sent as it is, and the bucket says no.
  if (smallest) return smallest;
  throw new Error("image encoding failed");
}

/**
 * A photograph kept on this phone, made fit for the bucket before it is sent.
 *
 * What this build writes already is, and is returned as it is. A report
 * saved, or a form left half filled in, under the build before holds the PNG
 * Safari wrote then, often over the 3 MB the bucket now takes, and its
 * reporter has no way to choose the photo again: it is written again here,
 * from its own pixels, which carry no metadata to lose. Anything that cannot
 * be decoded is sent as it is, for the server to answer.
 */
export async function fitForUpload(blob: Blob): Promise<Blob> {
  if ((blob.type === "image/webp" || blob.type === "image/jpeg") && blob.size <= MAX_UPLOAD_BYTES) return blob;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return blob;
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await encodePhoto(canvas);
  } catch (e) {
    console.error("[photo] could not write a kept photo again:", e);
    return blob;
  }
}
