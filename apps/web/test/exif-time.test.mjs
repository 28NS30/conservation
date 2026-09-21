/**
 * What time a record carries.
 *
 * A reporter photographs an animal at 07:32 and files at 19:40 when they find
 * signal. Stamping the submission time moves the record half a day, and on a
 * dataset about when animals are found, that moves a dawn roadkill peak into
 * the evening.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseExifDateTime } from "../lib/exifTime.ts";

const NOW = new Date("2026-09-20T12:00:00Z");

describe("EXIF capture time", () => {
  test("a reading with an offset is an exact instant", () => {
    // EXIF 2.31's OffsetTimeOriginal. Newer phones write it, and when they do
    // there is nothing to assume.
    const t = parseExifDateTime("2026:09:20 07:32:11", "+08:00", NOW);
    assert.equal(t?.toISOString(), "2026-09-19T23:32:11.000Z");
  });

  test("a negative offset works the other way", () => {
    const t = parseExifDateTime("2026:09:19 20:00:00", "-05:00", NOW);
    assert.equal(t?.toISOString(), "2026-09-20T01:00:00.000Z");
  });

  test("Z is tolerated even though EXIF does not write it", () => {
    const t = parseExifDateTime("2026:09:20 07:32:11", "Z", NOW);
    assert.equal(t?.toISOString(), "2026-09-20T07:32:11.000Z");
  });

  test("without an offset the reading is this device's wall clock", () => {
    // Not an ISO comparison: the answer depends on the runner's timezone, and
    // depending on it is the point. What must hold is that the fields come
    // back as they went in.
    const t = parseExifDateTime("2026:09:20 07:32:11", null, NOW);
    assert.ok(t);
    assert.equal(t.getFullYear(), 2026);
    assert.equal(t.getMonth(), 8);
    assert.equal(t.getDate(), 20);
    assert.equal(t.getHours(), 7);
    assert.equal(t.getMinutes(), 32);
  });

  describe("readings that cannot be believed", () => {
    for (const [name, raw] of [
      ["a camera that has never been set", "0000:00:00 00:00:00"],
      ["a dead clock at the epoch", "1970:01:01 00:00:00"],
      ["a day that does not exist", "2026:02:30 10:00:00"],
      ["a month that does not exist", "2026:13:01 10:00:00"],
      ["not a date at all", "yesterday afternoon"],
      ["an empty tag", ""],
    ]) {
      test(name, () => assert.equal(parseExifDateTime(raw, null, NOW), null));
    }

    test("a missing tag", () => {
      assert.equal(parseExifDateTime(undefined, undefined, NOW), null);
      assert.equal(parseExifDateTime(null, null, NOW), null);
    });

    test("a photo from the future", () => {
      // A clock hours fast is broken, and a record dated after it was filed is
      // one nobody can explain.
      assert.equal(parseExifDateTime("2026:09:21 12:00:00", "Z", NOW), null);
    });

    test("...but not one a few minutes fast, which is only drift", () => {
      const t = parseExifDateTime("2026:09:20 12:02:00", "Z", NOW);
      assert.equal(t?.toISOString(), "2026-09-20T12:02:00.000Z");
    });

    test("a corrupt offset is ignored rather than trusted", () => {
      // ±14:00 is the widest real offset. A tag past it would shift a record
      // by most of a day, so the reading falls back to the local clock.
      const t = parseExifDateTime("2026:09:20 07:32:11", "+99:00", NOW);
      assert.ok(t);
      assert.equal(t.getHours(), 7, "fell back to the wall clock");
    });
  });

  test("1990 is the floor, and it is inclusive-ish", () => {
    assert.equal(parseExifDateTime("1989:12:31 23:59:59", "Z", NOW), null);
    const t = parseExifDateTime("1990:01:01 00:00:01", "Z", NOW);
    assert.equal(t?.toISOString(), "1990-01-01T00:00:01.000Z");
  });

  test("sub-second precision is accepted and dropped", () => {
    const t = parseExifDateTime("2026:09:20 07:32:11.480", "Z", NOW);
    assert.equal(t?.toISOString(), "2026-09-20T07:32:11.000Z");
  });
});
