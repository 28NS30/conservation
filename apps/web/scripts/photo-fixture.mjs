/**
 * A phone photograph's metadata, built byte by byte, for the tests that prove
 * none of it reaches the bucket.
 *
 *   node apps/web/scripts/photo-fixture.mjs     # rewrites e2e/fixtures/photo-with-gps.jpg
 *
 * The photo spec (e2e/photo.spec.mjs) adds e2e/fixtures/photo-with-gps.jpg to
 * the report form: a small JPEG carrying what a phone writes, a GPS position,
 * the time the shutter fired and an XMP packet saying the position again. The
 * spec then reads what the browser uploaded and fails on any of it. The unit
 * tests build variants of the same blocks (test/photo-metadata.test.mjs).
 *
 * No dependency: the image is a baseline JPEG of flat 8x8 blocks, which needs
 * only each block's DC coefficient, so the encoder is a few lines rather than
 * a DCT. Any decoder reads it.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the fixture's camera says it was: 臺中, on land, inside Taiwan. */
export const FIXTURE_GPS = { lat: 24 + 8 / 60 + 51.72 / 3600, lng: 120 + 40 / 60 + 24.96 / 3600 };
/** When its shutter fired, as a phone writes it, and the offset it adds. */
export const FIXTURE_TAKEN = { local: "2026:09:20 07:32:11", offset: "+08:00", iso: "2026-09-19T23:32:11.000Z" };

const u16 = (n) => [(n >> 8) & 255, n & 255];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const bytes = (s) => [...Buffer.from(s, "latin1")];

/** One marker segment: FF, marker, length, payload. */
export function segment(marker, payload) {
  return Buffer.from([0xff, marker, ...u16(payload.length + 2), ...payload]);
}

/* ------------------------------------------------------------------ *
 * Exif: a big-endian TIFF block
 * ------------------------------------------------------------------ */

const TYPE = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7 };
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

/** An entry: { tag, type, values } — values are numbers, [num, den] pairs, or a string. */
const ascii = (tag, s) => ({ tag, type: TYPE.ASCII, values: [...bytes(s), 0] });
const short = (tag, ...v) => ({ tag, type: TYPE.SHORT, values: v });
const long = (tag, ...v) => ({ tag, type: TYPE.LONG, values: v });
const rational = (tag, ...pairs) => ({ tag, type: TYPE.RATIONAL, values: pairs });
const byte = (tag, ...v) => ({ tag, type: TYPE.BYTE, values: v });

function encodeValues({ type, values }) {
  if (type === TYPE.SHORT) return values.flatMap(u16);
  if (type === TYPE.LONG) return values.flatMap(u32);
  if (type === TYPE.RATIONAL) return values.flatMap(([n, d]) => [...u32(n), ...u32(d)]);
  return values;
}

/**
 * A TIFF block with IFD0 and, optionally, an Exif IFD and a GPS IFD, each
 * pointed to from IFD0 as a camera writes them. `next` gives IFD0 a following
 * IFD (a thumbnail's), which is what a camera original has.
 */
export function tiff({ ifd0 = [], exif = null, gps = null, next = false } = {}) {
  const ifds = [{ entries: [...ifd0] }];
  if (exif) ifds.push({ entries: exif, pointer: 0x8769 });
  if (gps) ifds.push({ entries: gps, pointer: 0x8825 });
  if (next) ifds.push({ entries: [short(0x0103, 6)], chained: true });
  // Pointer entries in IFD0 are LONGs, filled in once the offsets are known.
  for (const d of ifds.slice(1)) if (d.pointer) ifds[0].entries.push(long(d.pointer, 0));
  for (const d of ifds) d.entries.sort((a, b) => a.tag - b.tag);

  const sizeOf = (d) => {
    const data = d.entries.reduce((n, e) => {
      const len = encodeValues(e).length;
      return n + (len > 4 ? len + (len % 2) : 0);
    }, 0);
    return 2 + d.entries.length * 12 + 4 + data;
  };
  let offset = 8;
  for (const d of ifds) {
    d.offset = offset;
    offset += sizeOf(d);
  }
  for (const d of ifds.slice(1))
    if (d.pointer) ifds[0].entries.find((e) => e.tag === d.pointer).values = [d.offset];

  const out = [0x4d, 0x4d, 0x00, 0x2a, ...u32(8)];
  ifds.forEach((d, i) => {
    const table = [...u16(d.entries.length)];
    const data = [];
    const dataStart = d.offset + 2 + d.entries.length * 12 + 4;
    for (const e of d.entries) {
      const v = encodeValues(e);
      const count = e.type === TYPE.RATIONAL ? e.values.length : v.length / SIZE[e.type];
      table.push(...u16(e.tag), ...u16(e.type), ...u32(count));
      if (v.length <= 4) table.push(...v, ...Array(4 - v.length).fill(0));
      else {
        table.push(...u32(dataStart + data.length));
        data.push(...v);
        if (v.length % 2) data.push(0);
      }
    }
    const chained = i === 0 ? (ifds.find((x) => x.chained)?.offset ?? 0) : 0;
    table.push(...u32(chained));
    out.push(...table, ...data);
  });
  return Buffer.from(out);
}

const dms = (deg) => {
  const d = Math.floor(deg);
  const m = Math.floor((deg - d) * 60);
  const s = Math.round(((deg - d) * 60 - m) * 60 * 100);
  return [[d, 1], [m, 1], [s, 100]];
};

/** The GPS IFD of a phone at `at`. */
export function gpsEntries(at = FIXTURE_GPS) {
  return [
    byte(0x0000, 2, 3, 0, 0),
    ascii(0x0001, at.lat >= 0 ? "N" : "S"),
    rational(0x0002, ...dms(Math.abs(at.lat))),
    ascii(0x0003, at.lng >= 0 ? "E" : "W"),
    rational(0x0004, ...dms(Math.abs(at.lng))),
  ];
}

/** When the shutter fired, as the Exif IFD holds it. */
export function takenEntries(t = FIXTURE_TAKEN) {
  return [ascii(0x9003, t.local), ascii(0x9011, t.offset)];
}

/** What Apple's ImageIO writes into every canvas JPEG: pixels only (see lib/report/photoMetadata.ts). */
export function pixelEntries(width, height) {
  return { ifd0: [short(0x0112, 1)], exif: [short(0xa001, 1), long(0xa002, width), long(0xa003, height)] };
}

export { ascii as asciiEntry, short as shortEntry };

/** An APP1 Exif segment around a TIFF block. */
export const exifSegment = (block) => segment(0xe1, [...bytes("Exif\0\0"), ...block]);

/** An APP1 XMP segment saying where the photo was taken, as phone software writes it. */
export function xmpSegment(at = FIXTURE_GPS) {
  const packet =
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/"' +
    ` exif:GPSLatitude="${Math.floor(at.lat)},${((at.lat % 1) * 60).toFixed(4)}N"` +
    ` exif:GPSLongitude="${Math.floor(at.lng)},${((at.lng % 1) * 60).toFixed(4)}E"/>` +
    '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  return segment(0xe1, [...bytes("http://ns.adobe.com/xap/1.0/\0"), ...Buffer.from(packet, "utf8")]);
}

/* ------------------------------------------------------------------ *
 * The image: a baseline JPEG of flat 8x8 blocks
 * ------------------------------------------------------------------ */

// The standard luminance DC table (ITU T.81 Annex K.3), and an AC table that
// holds only end-of-block: a flat block has no AC coefficients.
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const AC_VALUES = [0x00];

/** Canonical Huffman codes from a DHT's counts and symbols: symbol → [code, length]. */
function huffmanCodes(bits, values) {
  const codes = new Map();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < bits[length - 1]; i++) codes.set(values[k++], [code++, length]);
    code <<= 1;
  }
  return codes;
}

/**
 * A JPEG of `width` x `height` pixels (multiples of 8) whose 8x8 blocks are
 * each one colour, `colour(bx, by)` → [r, g, b]. `extra` segments go after
 * the JFIF header, where a camera puts its Exif.
 */
export function flatBlockJpeg(width, height, colour, extra = []) {
  const dc = huffmanCodes(DC_BITS, DC_VALUES);
  const eob = huffmanCodes(AC_BITS, AC_VALUES).get(0x00);

  const out = [];
  let acc = 0;
  let n = 0;
  const put = (code, length) => {
    for (let i = length - 1; i >= 0; i--) {
      acc = (acc << 1) | ((code >> i) & 1);
      if (++n === 8) {
        out.push(acc);
        if (acc === 0xff) out.push(0x00); // byte stuffing
        acc = 0;
        n = 0;
      }
    }
  };

  const previous = [0, 0, 0];
  for (let by = 0; by < height / 8; by++)
    for (let bx = 0; bx < width / 8; bx++) {
      const [r, g, b] = colour(bx, by);
      const ycc = [
        0.299 * r + 0.587 * g + 0.114 * b,
        -0.168736 * r - 0.331264 * g + 0.5 * b + 128,
        0.5 * r - 0.418688 * g - 0.081312 * b + 128,
      ];
      ycc.forEach((value, c) => {
        // With a DC quantiser of 8 the quantised DC is the level shift itself.
        const q = Math.max(-128, Math.min(127, Math.round(value - 128)));
        const diff = q - previous[c];
        previous[c] = q;
        const category = diff === 0 ? 0 : Math.floor(Math.log2(Math.abs(diff))) + 1;
        put(...dc.get(category));
        if (category) put(diff > 0 ? diff : diff + (1 << category) - 1, category);
        put(...eob);
      });
    }
  if (n) put((1 << (8 - n)) - 1, 8 - n); // pad the last byte with ones

  const quant = [8, ...Array(63).fill(1)];
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, [...bytes("JFIF\0"), 1, 1, 0, ...u16(1), ...u16(1), 0, 0]),
    ...extra,
    segment(0xdb, [0x00, ...quant]),
    segment(0xc0, [8, ...u16(height), ...u16(width), 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
    segment(0xc4, [0x00, ...DC_BITS, ...DC_VALUES]),
    segment(0xc4, [0x10, ...AC_BITS, ...AC_VALUES]),
    segment(0xda, [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]),
    Buffer.from(out),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A field of greens and browns, so the photo is visibly a photo-shaped thing on screen. */
export const meadow = (bx, by) => {
  const shade = ((bx * 7 + by * 13) % 5) * 12;
  return by > 9 ? [96 + shade, 72 + shade / 2, 40] : [52 + shade, 112 + shade, 60 + shade / 3];
};

/** The photo the spec adds: a phone's GPS, capture time and XMP on a 160x120 picture. */
export function phonePhoto() {
  return flatBlockJpeg(160, 120, meadow, [
    exifSegment(
      tiff({
        ifd0: [ascii(0x010f, "FormosaWatch fixture"), short(0x0112, 1)],
        exif: takenEntries(),
        gps: gpsEntries(),
      }),
    ),
    xmpSegment(),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = join(import.meta.dirname, "..", "e2e", "fixtures", "photo-with-gps.jpg");
  writeFileSync(target, phonePhoto());
  console.log(`wrote ${target}`);
}
