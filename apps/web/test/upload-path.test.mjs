/**
 * The name of a stored photo should describe the photo.
 *
 * `/api/uploads/sign` ended every key `.webp`, which was true while the web
 * form was the only caller — its canvas re-encode always produces WebP. It
 * stops being true the moment anything else uploads: on iOS
 * `expo-image-manipulator` cannot write WebP at all, so an iOS photo arrives
 * as JPEG bytes at a `.webp` key.
 *
 * Nothing serves from the extension. Supabase returns the content type
 * recorded at upload, and `/api/reports` validates THAT against
 * ACCEPTED_IMAGE_TYPES rather than trusting the name, so the mismatch would
 * not have broken a page. It would have made every object in the bucket lie
 * about its contents — to the export, to a backup, to whoever opens one.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPTED_IMAGE_TYPES,
  imageExtension,
  isAcceptedImageType,
} from "@conservation/shared";

describe("a photo's extension comes from what it is", () => {
  for (const [type, ext] of [
    ["image/webp", "webp"],
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
  ]) {
    test(`${type} -> .${ext}`, () => assert.equal(imageExtension(type), ext));
  }

  test("every accepted type has an extension, and none is the fallback", () => {
    // If a fourth type is added to ACCEPTED_IMAGE_TYPES and not to the map,
    // its photos would all be stored as `.bin`. This is what notices.
    for (const t of ACCEPTED_IMAGE_TYPES)
      assert.notEqual(imageExtension(t), "bin", `${t} has no extension`);
  });

  test("something unheard of gets a name that claims nothing", () => {
    // Better an honest `.bin` than a confident `.webp`.
    assert.equal(imageExtension("image/avif"), "bin");
    assert.equal(imageExtension(""), "bin");
  });
});

describe("what the client is allowed to say it is uploading", () => {
  test("the three accepted types, and nothing else", () => {
    for (const t of ACCEPTED_IMAGE_TYPES) assert.equal(isAcceptedImageType(t), true);
    for (const t of ["image/avif", "image/gif", "text/html", "", null, undefined, 7, {}])
      assert.equal(isAcceptedImageType(t), false, `${String(t)} was accepted`);
  });

  test("it cannot smuggle a path through the content type", () => {
    // The extension is the only part of the key a client influences, and only
    // by naming a type from a fixed list. A value that is not on the list is
    // refused before it reaches the key, so `../` or a second dot never gets
    // near it.
    for (const t of ["image/webp/../../etc", "image/png;name=../x", "webp"])
      assert.equal(isAcceptedImageType(t), false);
    for (const t of ACCEPTED_IMAGE_TYPES)
      assert.match(imageExtension(t), /^[a-z0-9]{2,4}$/);
  });
});
