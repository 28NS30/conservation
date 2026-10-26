/**
 * What POST /api/reports refuses to attach: a photograph that carries a place,
 * a time or a name besides its pixels (lib/report/photoMetadata.ts).
 *
 * The phone photo here is built byte by byte (scripts/photo-fixture.mjs), as
 * is every variant of it. The two files from Apple's ImageIO are what Safari's
 * canvas writes, and what every browser on an iPhone writes, so they must pass:
 * refusing them would refuse every iPhone. They were made on macOS 26.5 by
 * test/fixtures/imageio-canvas.swift, which encodes a canvas-sized bitmap the
 * way WebKit does, with nothing but a quality.
 *
 *   node --test test/photo-metadata.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { photoMetadata, containerOf, webpChunks, pngChunks } from "../lib/report/photoMetadata.ts";
import {
  asciiEntry,
  exifSegment,
  flatBlockJpeg,
  gpsEntries,
  meadow,
  phonePhoto,
  pixelEntries,
  segment,
  takenEntries,
  tiff,
  xmpSegment,
} from "../scripts/photo-fixture.mjs";

const WEB = join(import.meta.dirname, "..");
const fixture = (...p) => readFileSync(join(WEB, ...p));
const jpeg = (...extra) => flatBlockJpeg(32, 16, meadow, extra);

/** A copy of a WebP with one more chunk, and the RIFF size to match. */
function withWebpChunk(webp, id, data) {
  const pad = data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  const head = Buffer.alloc(8);
  head.write(id, 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  const out = Buffer.concat([webp, head, data, pad]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

/** A copy of a PNG with one more chunk before IEND. */
function withPngChunk(png, id, data) {
  const iend = png.length - 12;
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(id, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([png.subarray(0, iend), head, data, crc, png.subarray(iend)]);
}

describe("a JPEG", () => {
  test("from a phone, with GPS, a capture time and XMP, is refused", () => {
    assert.notEqual(photoMetadata(fixture("e2e", "fixtures", "photo-with-gps.jpg")), null);
    assert.notEqual(photoMetadata(phonePhoto()), null);
  });

  test("with nothing but a GPS position in its Exif is refused for it", () => {
    assert.equal(photoMetadata(jpeg(exifSegment(tiff({ gps: gpsEntries() })))), "an Exif GPS position");
  });

  test("with a GPS position behind the pixel tags is refused for it", () => {
    const { ifd0, exif } = pixelEntries(32, 16);
    assert.equal(photoMetadata(jpeg(exifSegment(tiff({ ifd0, exif, gps: gpsEntries() })))), "an Exif GPS position");
  });

  test("with only the time the shutter fired is refused", () => {
    assert.match(photoMetadata(jpeg(exifSegment(tiff({ exif: takenEntries() })))), /Exif tag 0x9003/);
  });

  test("with a camera's name, or a thumbnail of the original, is refused", () => {
    assert.match(photoMetadata(jpeg(exifSegment(tiff({ ifd0: [asciiEntry(0x010f, "Apple")] })))), /0x010f/);
    assert.match(photoMetadata(jpeg(exifSegment(tiff({ ...pixelEntries(32, 16), next: true })))), /a second image/);
  });

  test("with XMP, a comment, IPTC or an unknown block is refused", () => {
    assert.equal(photoMetadata(jpeg(xmpSegment())), "XMP");
    assert.equal(photoMetadata(jpeg(segment(0xfe, [...Buffer.from("24.1477,120.6736")]))), "a JPEG comment");
    // An IPTC record (0x0404) that is not empty: City = 臺中.
    const city = Buffer.from([0x1c, 0x02, 0x5a, 0x00, 0x06, ...Buffer.from("臺中")]);
    const resource = Buffer.concat([Buffer.from("8BIM"), Buffer.from([0x04, 0x04, 0, 0]), Buffer.from([0, 0, 0, city.length]), city]);
    assert.match(photoMetadata(jpeg(segment(0xed, [...Buffer.from("Photoshop 3.0\0", "latin1"), ...resource]))), /IPTC/);
    assert.equal(photoMetadata(jpeg(segment(0xe5, [1, 2, 3]))), "an APP5 block");
  });

  test("with data hidden after the end of the image is refused", () => {
    assert.equal(photoMetadata(Buffer.concat([jpeg(), Buffer.from("lat=24.1477")])), "data after the end of the image");
  });

  test("cut short is refused, not read past its end", () => {
    const whole = phonePhoto();
    for (const at of [3, 10, 40, whole.length - 3])
      assert.notEqual(photoMetadata(whole.subarray(0, at)), null, `cut at ${at}`);
  });

  test("with only pixels, or only the tags an encoder writes about them, passes", () => {
    assert.equal(photoMetadata(jpeg()), null);
    assert.equal(photoMetadata(jpeg(exifSegment(tiff(pixelEntries(32, 16))))), null);
  });

  test("from Safari's canvas (Apple's ImageIO) passes", () => {
    // Its own Exif (colour space, pixel dimensions) and an empty IPTC record
    // with its digest. Every browser on an iPhone writes these.
    const b = fixture("test", "fixtures", "imageio-canvas.jpg");
    assert.ok(b.includes(Buffer.from("Exif\0\0", "latin1")), "the fixture no longer has ImageIO's Exif block");
    assert.ok(b.includes(Buffer.from("Photoshop 3.0", "latin1")), "the fixture no longer has ImageIO's APP13 block");
    assert.equal(photoMetadata(b), null);
  });
});

describe("a WebP", () => {
  const home = fixture("public", "home", "muntjac.webp");

  test("as a browser's canvas writes it passes", () => {
    assert.equal(containerOf(home), "webp");
    assert.equal(photoMetadata(home), null);
  });

  test("with an EXIF chunk holding a position, or an XMP chunk, is refused", () => {
    assert.equal(photoMetadata(withWebpChunk(home, "EXIF", tiff({ gps: gpsEntries() }))), "an Exif GPS position");
    assert.equal(photoMetadata(withWebpChunk(home, "XMP ", Buffer.from("<x:xmpmeta/>"))), "XMP");
    assert.deepEqual(webpChunks(withWebpChunk(home, "XMP ", Buffer.from("x"))).at(-1).id, "XMP ");
  });
});

describe("a PNG", () => {
  const canvas = fixture("test", "fixtures", "imageio-canvas.png");

  test("from Safari's canvas passes, eXIf and all", () => {
    assert.ok(pngChunks(canvas).some((c) => c.id === "eXIf"), "the fixture no longer has ImageIO's eXIf chunk");
    assert.equal(photoMetadata(canvas), null);
  });

  test("with a position in eXIf, XMP in iTXt or any text chunk is refused", () => {
    assert.equal(photoMetadata(withPngChunk(canvas, "eXIf", tiff({ gps: gpsEntries() }))), "an Exif GPS position");
    assert.equal(photoMetadata(withPngChunk(canvas, "iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x/>"))), "a PNG iTXt chunk");
    assert.equal(photoMetadata(withPngChunk(canvas, "tEXt", Buffer.from("Comment\0Taichung"))), "a PNG tEXt chunk");
  });
});

describe("anything else", () => {
  test("is not a photo this site stores", () => {
    for (const bytes of [
      Buffer.from("<html><body>hello</body></html>"),
      Buffer.from([0, 0, 0, 0x18, ...Buffer.from("ftypheic")]),
      Buffer.alloc(0),
    ])
      assert.equal(photoMetadata(bytes), "not a JPEG, PNG or WebP file");
  });
});
