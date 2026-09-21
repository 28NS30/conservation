/**
 * What kind of record this is, once somebody says what the animal was.
 *
 * `category` was written once at insert, from what the reporter answered, and
 * never revisited. So a `sighting` later confirmed to be a listed invasive
 * stayed a `sighting` and never appeared under the map's invasive filter: the
 * record was right about the animal and wrong about what kind of record it
 * was. Nothing failed, and the count that was wrong was the one the invasive
 * filter exists to show.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  conditionOf,
  deriveCategory,
  recategorise,
} from "@conservation/shared";

describe("the condition a stored category implies", () => {
  for (const [category, condition] of [
    ["roadkill", "dead"],
    ["injured", "hurt"],
    ["sighting", "well"],
    ["invasive", "well"],
  ]) {
    test(`${category} -> ${condition}`, () =>
      assert.equal(conditionOf(category), condition));
  }

  test("it round-trips through deriveCategory for every category", () => {
    // The inverse has to be a real inverse, or a correction that changes
    // nothing about the species could still change the record.
    for (const c of ["roadkill", "injured", "sighting", "invasive"]) {
      const again = deriveCategory(conditionOf(c), {
        taxonIsInvasive: c === "invasive" ? true : c === "sighting" ? false : null,
        saysIntroduced: c === "invasive",
      });
      assert.equal(again, c, `${c} did not survive the round trip`);
    }
  });
});

describe("re-deriving after a species is named", () => {
  test("a sighting of a listed invasive becomes invasive", () => {
    assert.equal(recategorise("sighting", true), "invasive");
  });

  test("an 'invasive' the reporter guessed, named as a native, becomes a sighting", () => {
    // A named taxon outranks a belief. This is the direction that corrects a
    // reporter rather than the map.
    assert.equal(recategorise("invasive", false), "sighting");
  });

  describe("condition is final, whatever the species turns out to be", () => {
    for (const [category, flag] of [
      ["roadkill", true],
      ["roadkill", false],
      ["roadkill", null],
      ["injured", true],
      ["injured", false],
      ["injured", null],
    ]) {
      test(`${category} + invasive=${flag} stays ${category}`, () => {
        // A dead invasive is a roadkill record: "something was killed on this
        // road" is what the record is for, and an invasive count that includes
        // corpses is a different measurement.
        assert.equal(recategorise(category, flag), category);
      });
    }
  });

  describe("when the register has no opinion, the reporter's stands", () => {
    test("a sighting stays a sighting", () => {
      assert.equal(recategorise("sighting", null), "sighting");
    });

    test("an invasive stays invasive", () => {
      // The reporter said "I think it's introduced" and TaiCOL does not say
      // otherwise. Discarding that would be answering a question nobody asked.
      assert.equal(recategorise("invasive", null), "invasive");
    });
  });

  test("a correction that agrees with the record changes nothing", () => {
    assert.equal(recategorise("invasive", true), "invasive");
    assert.equal(recategorise("sighting", false), "sighting");
  });
});
