/**
 * The home page's photographs: credited, and carrying nothing but pixels.
 *
 * NO METADATA. A camera photo can hold GPS coordinates, and this project exists
 * to keep protected species' locations private. The photographs were sourced
 * from Wikimedia Commons and re-encoded with nothing carried over — and it
 * mattered: the macaque photo arrived with coordinates embedded. This reads each
 * WebP's own chunk list and fails on EXIF or XMP, so a file dropped in later
 * straight from a camera or a download cannot slip through.
 *
 * NO UNCREDITED FILE. Every photograph is CC BY or CC BY-SA, which require
 * credit. Every file in public/home must be in lib/home/photos.ts (which is
 * where the credit lives), and every entry there must have a file.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "..");
const DIR = join(WEB, "public", "home");
const files = readdirSync(DIR).filter((f) => !f.startsWith("."));
const manifest = readFileSync(join(WEB, "lib", "home", "photos.ts"), "utf8");

/** The four-character chunk ids of a RIFF/WebP file. */
function webpChunks(buf) {
  assert.equal(buf.toString("ascii", 0, 4), "RIFF", "not a RIFF file");
  assert.equal(buf.toString("ascii", 8, 12), "WEBP", "not a WebP file");
  const ids = [];
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    ids.push(id);
    at += 8 + size + (size % 2); // chunks are padded to an even length
  }
  return ids;
}

describe("home photographs", () => {
  test("there are photographs to check", () => {
    assert.ok(files.length >= 6, `found ${files.length}`);
  });

  for (const f of files) {
    test(`${f} carries no EXIF or XMP`, () => {
      assert.match(f, /\.webp$/, `${f}: only WebP is expected here, and only WebP is parsed`);
      const ids = webpChunks(readFileSync(join(DIR, f)));
      assert.ok(!ids.includes("EXIF"), `${f} has an EXIF chunk — it may hold GPS coordinates`);
      assert.ok(!ids.includes("XMP "), `${f} has an XMP chunk — it may hold GPS coordinates`);
    });

    test(`${f} is credited in lib/home/photos.ts`, () => {
      assert.ok(manifest.includes(`src: "/home/${f}"`), `${f} is on the site with no credit`);
    });
  }

  test("every credited photograph exists, with its licence and author", () => {
    const entries = [...manifest.matchAll(/src: "\/home\/([^"]+)"[\s\S]*?author: "([^"]*)"[\s\S]*?license: "([^"]*)"/g)];
    assert.ok(entries.length >= 6);
    for (const [, file, author, license] of entries) {
      assert.ok(files.includes(file), `${file} is credited but missing`);
      assert.ok(author.trim(), `${file} has no author`);
      assert.match(license, /^CC (BY|BY-SA) \d\.\d$|^CC0$|^Public domain$/, `${file}: "${license}" is not a licence this site can use`);
    }
  });
});
