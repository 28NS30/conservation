/**
 * What the Darwin Core archive tells GBIF about a blurred coordinate.
 *
 * These two sentences leave the project. Someone reading an occurrence in
 * GBIF's interface has only them to judge a 10 km coordinate by, and they will
 * never see this site to check.
 *
 * Both used to be constants asserting a sensitive taxon, which was true while
 * a sensitivity rating was the only reason to blur anything. Migration 0011
 * added a second reason — nobody has identified the animal — and on production
 * that is 3,801 records with no taxon at all.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  establishment,
  generalisation,
  UNCERTAINTY,
  vitality,
} from "../../../scripts/dwc-terms.ts";

const base = {
  is_obscured: true,
  location_precision: "coarse_10km",
  taxon_id: 28758,
  sensitivity: null,
  protected_status: null,
};

describe("why a coordinate was generalised", () => {
  test("a record at full precision declares nothing", () => {
    const t = generalisation({ ...base, is_obscured: false, location_precision: "exact" });
    assert.deepEqual(t, { dataGeneralizations: "", informationWithheld: "" });
  });

  test("a sensitive taxon says so, as it always did", () => {
    const t = generalisation({ ...base, sensitivity: "輕度" });
    assert.match(t.dataGeneralizations, /rated sensitive in TaiCOL/);
    assert.match(t.dataGeneralizations, /approximately 10 km/);
    assert.equal(t.informationWithheld, "Exact coordinates withheld for a sensitive taxon");
  });

  test("a protected status counts as rated, even with no sensitivity", () => {
    const t = generalisation({ ...base, protected_status: "III" });
    assert.match(t.dataGeneralizations, /rated sensitive in TaiCOL/);
  });

  test("an empty string is not a rating", () => {
    // TaiCOL's import leaves blanks in places; "" must not be read as a reason.
    const t = generalisation({ ...base, sensitivity: "", protected_status: "   " });
    assert.doesNotMatch(t.dataGeneralizations, /rated sensitive/);
  });

  describe("a record nobody has identified", () => {
    const t = generalisation({ ...base, taxon_id: null });

    test("does not claim a taxon is rated, because it has no taxon", () => {
      assert.doesNotMatch(t.dataGeneralizations, /taxon is rated/);
      assert.doesNotMatch(t.informationWithheld, /sensitive taxon/);
    });

    test("says what is actually true of it", () => {
      assert.match(t.dataGeneralizations, /has not been identified/);
      assert.equal(t.informationWithheld, "Exact coordinates withheld pending identification");
    });

    test("still declares the distance", () => {
      assert.match(t.dataGeneralizations, /approximately 10 km/);
    });
  });

  describe("an identified record blurred by a publisher override", () => {
    // What scripts/remap-gbif-taxa.ts writes when correcting a name would
    // otherwise loosen a blur: 371 records on production carry one.
    const t = generalisation(base);

    test("does not claim the current taxon is rated, because it is not", () => {
      assert.doesNotMatch(t.dataGeneralizations, /rated sensitive in TaiCOL/);
    });

    test("names the publisher as the reason", () => {
      assert.match(t.dataGeneralizations, /by the publisher/);
      assert.equal(t.informationWithheld, "Exact coordinates withheld by the publisher");
    });
  });

  test("50 km reads as 50 km", () => {
    const t = generalisation({ ...base, location_precision: "coarse_50km", sensitivity: "重度" });
    assert.match(t.dataGeneralizations, /approximately 50 km/);
  });

  test("a precision this file has not caught up with says less, not nonsense", () => {
    // "approximately undefined km" is worse than declining to give a figure.
    const t = generalisation({ ...base, location_precision: "coarse_200km" });
    assert.doesNotMatch(t.dataGeneralizations, /undefined|NaN/);
    assert.match(t.dataGeneralizations, /a coarser precision/);
  });

  test("the declared uncertainties are the ones the archive publishes", () => {
    assert.deepEqual(UNCERTAINTY, { exact: 30, coarse_10km: 10_000, coarse_50km: 50_000 });
  });
});

describe("whether the animal was alive (dwc:vitality)", () => {
  // Read off the page the report was filed on. Only the roadkill page's
  // "dead" answer is dead: an injured animal is alive, and GBIF users filter
  // on this term when they want specimens rather than sightings.
  for (const [category, expected] of [
    ["roadkill", "dead"],
    ["injured", "alive"],
    ["sighting", "alive"],
    ["invasive", "alive"],
  ])
    test(`${category} -> ${expected}`, () => assert.equal(vitality(category), expected));
});

describe("how the species came to be here (dwc:establishmentMeans)", () => {
  const named = { taxon_id: 29144, is_invasive: false };

  test("TaiCOL's native is native", () => {
    assert.equal(establishment({ ...named, alien_type: "native" }).establishmentMeans, "native");
  });

  test("every alien status TaiCOL uses is introduced", () => {
    for (const alien of ["invasive", "naturalized", "cultured", "cultivated"])
      assert.equal(
        establishment({ ...named, alien_type: alien }).establishmentMeans,
        "introduced",
        alien,
      );
  });

  test("no status is not a claim of native", () => {
    // 55,000 taxa carry no alien status in our copy. "Not recorded" is not
    // "native", and GBIF would read an empty term correctly.
    assert.equal(establishment({ ...named, alien_type: null }).establishmentMeans, "");
  });

  test("an invasive record says so, in degreeOfEstablishment", () => {
    const t = establishment({ taxon_id: 29144, alien_type: "invasive", is_invasive: true });
    assert.deepEqual(t, { establishmentMeans: "introduced", degreeOfEstablishment: "invasive" });
  });

  test("a naturalized species is introduced but not called invasive", () => {
    const t = establishment({ ...named, alien_type: "naturalized" });
    assert.equal(t.degreeOfEstablishment, "");
  });

  test("a record with no species claims nothing about one", () => {
    // Filed on the invasive page and unidentified, it is in the site's
    // invasive collection; it is still not a statement about any taxon.
    assert.deepEqual(
      establishment({ taxon_id: null, alien_type: null, is_invasive: true }),
      { establishmentMeans: "", degreeOfEstablishment: "" },
    );
  });
});
