/**
 * What a stored photograph carries besides its pixels.
 *
 * The report form strips a photo's metadata in the browser: the canvas
 * re-encode in lib/image.ts keeps nothing but pixels. That was the only place
 * it happened. Anything else that can reach a signed upload URL — a native
 * client, a script, a browser that one day encodes differently — could store a
 * phone's original, and the original of a photograph of a protected animal
 * holds the exact point the record's blur exists to hide. So POST /api/reports
 * reads each photo it is asked to attach and refuses one that carries a
 * location, or anything a location could be written in.
 *
 * Not every Exif block is refused, and this is the reason the rule is longer
 * than "no APP1". Apple's ImageIO, which encodes every canvas in Safari and in
 * every other browser on an iPhone (WebKit's ImageBufferUtilitiesCG passes it
 * nothing but a quality), writes an Exif block of its own into a JPEG and a
 * PNG: the colour space and the pixel dimensions, under an Exif IFD pointer,
 * and an APP13 block holding an empty IPTC record and its digest. Measured on
 * macOS 26.5, 26 October 2026; test/fixtures/imageio-canvas.* are those files.
 * Refusing any Exif would refuse every photo sent from an iPhone. So an Exif
 * block may hold the tags an encoder writes about the pixels themselves, and
 * nothing else: a GPS IFD, a camera's make, a time, a comment, a maker note or
 * a second image all refuse the photo, as do XMP, IPTC records, comments and
 * text chunks, whatever they say. An allowlist, so a tag nobody thought of is
 * refused rather than waved through.
 *
 * Pure, and over a Uint8Array, so the server, the tests and a browser can all
 * run it. test/home-photos.test.mjs reads the home page's photographs with the
 * same walkers.
 */

export type PhotoContainer = "jpeg" | "png" | "webp";

/** The content type each container is stored under. */
export const CONTAINER_TYPE: Readonly<Record<PhotoContainer, string>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Which container the bytes are, by their own signature; null for none of the three. */
export function containerOf(b: Uint8Array): PhotoContainer | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  return null;
}

/** Thrown by a walker when a length points past the end of the file. */
class Truncated extends Error {}

/* ------------------------------------------------------------------ *
 * The walkers
 * ------------------------------------------------------------------ */

export type Chunk = { id: string; start: number; size: number };

/** A RIFF/WebP file's chunks: id, where its data starts, and its length. */
export function webpChunks(b: Uint8Array): Chunk[] {
  if (containerOf(b) !== "webp") throw new Error("not a WebP file");
  const dv = view(b);
  const out: Chunk[] = [];
  for (let at = 12; at + 8 <= b.length; ) {
    const size = dv.getUint32(at + 4, true);
    if (at + 8 + size > b.length) throw new Truncated();
    out.push({ id: ascii(b, at, at + 4), start: at + 8, size });
    at += 8 + size + (size % 2); // chunks are padded to an even length
  }
  return out;
}

/** A PNG's chunks, and where the file ends after IEND. */
export function pngChunks(b: Uint8Array): Chunk[] & { end?: number } {
  if (containerOf(b) !== "png") throw new Error("not a PNG file");
  const dv = view(b);
  const out: Chunk[] & { end?: number } = [];
  for (let at = 8; at + 12 <= b.length; ) {
    const size = dv.getUint32(at);
    if (at + 12 + size > b.length) throw new Truncated();
    const id = ascii(b, at + 4, at + 8);
    out.push({ id, start: at + 8, size });
    at += 12 + size;
    if (id === "IEND") {
      out.end = at;
      break;
    }
  }
  return out;
}

/**
 * A JPEG's marker segments, scans included, and where it ends after EOI.
 *
 * Every segment, not only those before the first scan: a progressive JPEG
 * may put tables, comments and APPn blocks between its scans, so the walk
 * steps over each scan's entropy-coded data to the next marker.
 */
export function jpegSegments(b: Uint8Array): { marker: number; start: number; size: number }[] & { end?: number } {
  if (containerOf(b) !== "jpeg") throw new Error("not a JPEG file");
  const dv = view(b);
  const out: { marker: number; start: number; size: number }[] & { end?: number } = [];
  let at = 2;
  while (at < b.length) {
    if (b[at] !== 0xff) throw new Truncated();
    while (b[at] === 0xff) at++; // fill bytes
    const marker = b[at++];
    if (marker === undefined) throw new Truncated();
    if (marker === 0xd9) {
      out.end = at;
      return out;
    }
    // Markers with no length: TEM and the restart markers.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (at + 2 > b.length) throw new Truncated();
    const length = dv.getUint16(at);
    if (length < 2 || at + length > b.length) throw new Truncated();
    out.push({ marker, start: at + 2, size: length - 2 });
    at += length;
    if (marker === 0xda) {
      // Entropy-coded data: up to the next marker that is not a stuffed
      // 0xFF00 or a restart marker.
      while (at + 1 < b.length) {
        if (b[at] === 0xff && b[at + 1] !== 0x00 && !(b[at + 1] >= 0xd0 && b[at + 1] <= 0xd7)) break;
        at++;
      }
      if (at + 1 >= b.length) throw new Truncated();
    }
  }
  throw new Truncated();
}

/* ------------------------------------------------------------------ *
 * What is allowed through
 * ------------------------------------------------------------------ */

/**
 * The Exif tags an encoder writes about the pixels, which say nothing about
 * where or when the photograph was taken or by whom. IFD0: the image's size,
 * sampling, orientation and resolution, and the pointer to the Exif IFD. The
 * Exif IFD: its version, the colour space and the pixel dimensions.
 */
const PIXEL_TAGS_IFD0: ReadonlySet<number> = new Set([
  0x0100, 0x0101, 0x0102, 0x0103, 0x0106, 0x0112, 0x0115, 0x011a, 0x011b, 0x011c, 0x0128, 0x0213,
]);
const EXIF_IFD_POINTER = 0x8769;
const GPS_IFD_POINTER = 0x8825;
const PIXEL_TAGS_EXIF: ReadonlySet<number> = new Set([0x9000, 0x9101, 0xa000, 0xa001, 0xa002, 0xa003]);

const hex = (tag: number) => `0x${tag.toString(16).padStart(4, "0")}`;

/**
 * What an Exif (TIFF) block holds beyond the pixel tags, or null when nothing.
 * A block that cannot be read is refused too: whatever it holds cannot be
 * shown to be harmless.
 */
export function exifFinding(tiff: Uint8Array): string | null {
  // Some writers put WebP's and PNG's Exif behind the JPEG APP1 header too.
  if (ascii(tiff, 0, 6) === "Exif\0\0") tiff = tiff.subarray(6);
  if (tiff.length < 8) return "an unreadable Exif block";
  const order = ascii(tiff, 0, 2);
  if (order !== "II" && order !== "MM") return "an unreadable Exif block";
  const le = order === "II";
  const dv = view(tiff);
  if (dv.getUint16(2, le) !== 42) return "an unreadable Exif block";

  const ifd = (offset: number, allowed: ReadonlySet<number>, where: string): string | null => {
    if (offset + 2 > tiff.length) return "an unreadable Exif block";
    const n = dv.getUint16(offset, le);
    const next = offset + 2 + n * 12;
    if (next + 4 > tiff.length) return "an unreadable Exif block";
    for (let i = 0; i < n; i++) {
      const at = offset + 2 + i * 12;
      const tag = dv.getUint16(at, le);
      if (tag === GPS_IFD_POINTER) return "an Exif GPS position";
      if (where === "IFD0" && tag === EXIF_IFD_POINTER) {
        const inner = ifd(dv.getUint32(at + 8, le), PIXEL_TAGS_EXIF, "Exif IFD");
        if (inner) return inner;
        continue;
      }
      if (!allowed.has(tag)) return `Exif tag ${hex(tag)} in the ${where}`;
    }
    // A second IFD is a second image: a camera's thumbnail of the original.
    if (dv.getUint32(next, le) !== 0) return `a second image after the ${where}`;
    return null;
  };
  return ifd(dv.getUint32(4, le), PIXEL_TAGS_IFD0, "IFD0");
}

/**
 * Whether a Photoshop APP13 block holds anything: ImageIO writes one with an
 * empty IPTC record (resource 0x0404, no bytes) and that record's digest
 * (0x0425). Any IPTC dataset, or any other resource, is refused: IPTC has
 * fields for a city, a sublocation and a country.
 */
function photoshopFinding(s: Uint8Array): string | null {
  const header = "Photoshop 3.0\0";
  if (ascii(s, 0, header.length) !== header) return "an APP13 block";
  const dv = view(s);
  for (let at = header.length; at < s.length; ) {
    if (at + 7 > s.length || ascii(s, at, at + 4) !== "8BIM") return "an unreadable Photoshop block";
    const id = dv.getUint16(at + 4);
    const nameLength = s[at + 6];
    let size = at + 7 + nameLength;
    if ((1 + nameLength) % 2) size++; // the name is padded to an even length
    if (size + 4 > s.length) return "an unreadable Photoshop block";
    const length = dv.getUint32(size);
    if (size + 4 + length > s.length) return "an unreadable Photoshop block";
    if (!((id === 0x0404 && length === 0) || id === 0x0425)) return `Photoshop resource ${hex(id)} (IPTC)`;
    at = size + 4 + length + (length % 2); // and so is the data
  }
  return null;
}

/** Bytes after the end of the image that are not padding. */
function trailing(b: Uint8Array, end: number | undefined): string | null {
  if (end === undefined) return "an image with no end";
  for (let i = end; i < b.length; i++) if (b[i] !== 0x00 && b[i] !== 0xff) return "data after the end of the image";
  return null;
}

function jpegFinding(b: Uint8Array): string | null {
  const segments = jpegSegments(b);
  for (const { marker, start, size } of segments) {
    const s = b.subarray(start, start + size);
    if (marker === 0xfe) return "a JPEG comment";
    if (marker === 0xee) continue; // Adobe: the colour transform, nothing else
    if (marker === 0xe0) {
      // JFIF's header, and nothing more: its two thumbnail sizes (bytes 12
      // and 13) are zero. A thumbnail, or a JFXX extension, is a second
      // picture, which can be the photograph before it was cropped.
      if (ascii(s, 0, 5) === "JFIF\0" && size >= 14 && s[12] === 0 && s[13] === 0) continue;
      return ascii(s, 0, 5) === "JFXX\0" ? "a JFXX thumbnail" : "an APP0 block";
    }
    if (marker === 0xe1) {
      if (ascii(s, 0, 6) === "Exif\0\0") {
        const found = exifFinding(s.subarray(6));
        if (found) return found;
        continue;
      }
      return ascii(s, 0, 20).startsWith("http://ns.adobe.com/") ? "XMP" : "an APP1 block";
    }
    if (marker === 0xe2) {
      if (ascii(s, 0, 12) === "ICC_PROFILE\0") continue;
      return "an APP2 block";
    }
    if (marker === 0xed) {
      const found = photoshopFinding(s);
      if (found) return found;
      continue;
    }
    if (marker >= 0xe0 && marker <= 0xef) return `an APP${marker - 0xe0} block`;
  }
  return trailing(b, segments.end);
}

/**
 * The PNG chunks a picture is made of: its header, pixels and palette, and
 * how its colours are meant. Any other chunk refuses the photo, as an unknown
 * JPEG marker does: tEXt, zTXt and iTXt (XMP) hold whatever text a writer
 * chose, and a chunk nobody listed here, such as C2PA's caBX, can carry the
 * same Exif inside it.
 */
const PNG_PICTURE = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS",
  "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP", "mDCV", "cLLI",
  "bKGD", "hIST", "pHYs",
]);

function pngFinding(b: Uint8Array): string | null {
  const chunks = pngChunks(b);
  for (const { id, start, size } of chunks) {
    if (id === "eXIf") {
      const found = exifFinding(b.subarray(start, start + size));
      if (found) return found;
      continue;
    }
    if (!PNG_PICTURE.has(id)) return `a PNG ${id} chunk`;
  }
  return trailing(b, chunks.end);
}

/** The WebP chunks a picture is made of; anything else refuses it, as in a PNG. */
const WEBP_PICTURE = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP", "ANIM", "ANMF"]);

function webpFinding(b: Uint8Array): string | null {
  const riffEnd = 8 + view(b).getUint32(4, true);
  for (const { id, start, size } of webpChunks(b.subarray(0, Math.min(b.length, riffEnd)))) {
    if (id === "XMP ") return "XMP";
    if (id === "EXIF") {
      const found = exifFinding(b.subarray(start, start + size));
      if (found) return found;
      continue;
    }
    if (!WEBP_PICTURE.has(id)) return `a WebP ${id.trim()} chunk`;
  }
  return trailing(b, riffEnd > b.length ? undefined : riffEnd);
}

/**
 * Why a photograph carries more than its pixels, in a few words for a log, or
 * null when it carries nothing a place, a time or a name could be kept in.
 * Bytes that are none of the three containers, or that end before their own
 * lengths say they do, are refused as well.
 */
export function photoMetadata(b: Uint8Array): string | null {
  const container = containerOf(b);
  if (!container) return "not a JPEG, PNG or WebP file";
  try {
    if (container === "jpeg") return jpegFinding(b);
    if (container === "png") return pngFinding(b);
    return webpFinding(b);
  } catch (e) {
    if (e instanceof Truncated || e instanceof RangeError) return "a file that ends before its own lengths say";
    // Anything else the walkers trip on, such as a RIFF header whose size is
    // shorter than its own WEBP tag, is a file they cannot read either, and is
    // refused the same way. Thrown, it was a 500, which the offline queue
    // retries for two weeks.
    return "a file its own structure does not describe";
  }
}
