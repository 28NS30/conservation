/**
 * What the GBIF importer is allowed to call an animal.
 *
 * The first import matched TaiRON's records against GBIF's `species` field, which
 * is GBIF's own answer after re-filing the occurrence under its backbone
 * taxonomy — not the name the publisher wrote. Two failures followed, and both
 * are pinned here because neither is visible from the outside:
 *
 *   - "Canis lupus familiaris" (a dog) collapsed to `species` "Canis lupus" and
 *     matched 狼, the wolf: fourteen public records of an animal that does not
 *     live here, blurred as a protected species because the wolf is one.
 *   - "Melogale moschata subaurantiaca" collapsed to the bare species, which
 *     TaiCOL does not record in Taiwan, so 747 ferret-badger records sat on a
 *     taxon /species refuses to list and /stats happily counted.
 *
 * The matcher is pure, so all of this runs without a database.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  publishedName,
  matchTaxon,
  matchLocal,
  elevatedSubspecies,
} from "../../../scripts/taxon-names.ts";

/** A taxon index built by hand, so the assertions are about the rules only. */
function index(rows) {
  const byName = new Map();
  const byTaicolId = new Map();
  for (const r of rows) {
    const full = {
      rank: "Species",
      taxon_status: "accepted",
      common_name_zh: null,
      ...r,
    };
    const k = full.scientific_name.toLowerCase();
    if (!byName.has(k)) byName.set(k, full);
    byTaicolId.set(full.taicol_id, full);
  }
  return { byName, byTaicolId };
}

const WOLF = { id: 97489, taicol_id: "t0097489", scientific_name: "Canis lupus", is_in_taiwan: true };
const DOG = { id: 85383, taicol_id: "t0085383", scientific_name: "Canis familiaris", is_in_taiwan: true };
const BADGER_ABROAD = { id: 96345, taicol_id: "t0096345", scientific_name: "Melogale moschata", is_in_taiwan: false };
const BADGER_HERE = { id: 27888, taicol_id: "t0027888", scientific_name: "Melogale subaurantiaca", is_in_taiwan: true };

describe("the name TaiRON published", () => {
  test("is the Darwin Core atoms, not GBIF's answer", () => {
    assert.equal(
      publishedName({
        genericName: "Canis",
        specificEpithet: "lupus",
        infraspecificEpithet: "familiaris",
        species: "Canis lupus",
      }),
      "Canis lupus familiaris",
    );
    assert.equal(
      publishedName({ genericName: "Passer", specificEpithet: "montanus" }),
      "Passer montanus",
    );
  });

  test("a genus on its own is not a published name", () => {
    // Otherwise "Rattus" would be pushed into verbatim_name in place of GBIF's
    // fuller "Rattus Fischer, 1803", and could never match a species anyway.
    assert.equal(publishedName({ genericName: "Rattus" }), null);
    assert.equal(publishedName({ scientificName: "Ranidae" }), null);
  });
});

describe("the matcher", () => {
  const dogRecord = {
    genericName: "Canis",
    specificEpithet: "lupus",
    infraspecificEpithet: "familiaris",
    species: "Canis lupus",
  };

  test("the crosswalk is the only thing between a dog and the wolf", () => {
    // TaiCOL split the dog out of the wolf, so GBIF's collapsed `species` names a
    // real Taiwanese taxon — the wrong one. No rule about ranks or epithets can
    // tell that apart from an ordinary subspecies collapse, which is correct and
    // common. Only a named decision can, which is why scripts/taxon-crosswalk.json
    // is committed and the importer says so loudly when it is missing.
    const idx = index([WOLF, DOG]);

    const without = matchTaxon(idx, new Map(), dogRecord);
    assert.equal(without.taxon.id, WOLF.id, "without it, still the wolf");

    const cw = new Map([["canis lupus familiaris", { taicol_id: "t0085383" }]]);
    const withIt = matchTaxon(idx, cw, dogRecord);
    assert.equal(withIt.via, "crosswalk");
    assert.equal(withIt.taxon.id, DOG.id);
    assert.equal(withIt.verbatim, null, "a matched row carries no verbatim name");
  });

  test("an exact match on the published name outranks the crosswalk", () => {
    // TaiRON's identification stands. If TaiCOL holds the name as published,
    // nothing else gets a say.
    const idx = index([
      WOLF,
      DOG,
      { id: 1, taicol_id: "t0000001", scientific_name: "Canis lupus familiaris", is_in_taiwan: true, rank: "Subspecies" },
    ]);
    const cw = new Map([["canis lupus familiaris", { taicol_id: "t0085383" }]]);
    const m = matchTaxon(idx, cw, dogRecord);
    assert.equal(m.via, "published");
    assert.equal(m.taxon.id, 1);
  });

  test("GBIF's species is accepted only when that taxon is in Taiwan", () => {
    const idx = index([BADGER_ABROAD, BADGER_HERE]);
    const m = matchTaxon(idx, new Map(), {
      genericName: "Melogale",
      specificEpithet: "moschata",
      infraspecificEpithet: "subaurantiaca",
      species: "Melogale moschata",
    });
    assert.equal(m.taxon, null, "the bare species is not recorded in Taiwan");
    assert.equal(m.verbatim, "Melogale moschata subaurantiaca");
  });

  test("an ordinary binomial still matches on its own name", () => {
    const idx = index([
      { id: 36854, taicol_id: "t0036854", scientific_name: "Protobothrops mucrosquamatus", is_in_taiwan: true },
    ]);
    const m = matchTaxon(idx, new Map(), {
      genericName: "Protobothrops",
      specificEpithet: "mucrosquamatus",
      species: "Protobothrops mucrosquamatus",
    });
    assert.equal(m.via, "published");
    assert.equal(m.taxon.id, 36854);
  });

  test("an unidentified record keeps its name and gains no taxon", () => {
    const m = matchTaxon(index([]), new Map(), { scientificName: "Ranidae" });
    assert.equal(m.taxon, null);
    assert.equal(m.via, "none");
    assert.equal(m.verbatim, "Ranidae", "so the record page can still say what it is");
  });

  test("a name in Taiwan wins over the same name abroad", () => {
    // The index is ordered is_in_taiwan first, which is the whole reason a plain
    // lookup is allowed to stand in for "the Taiwanese taxon of that name".
    const idx = index([
      { id: 2, taicol_id: "t2", scientific_name: "Cyclophiops major", is_in_taiwan: true },
    ]);
    assert.equal(matchLocal(idx, "cyclophiops major").id, 2);
  });
});

describe("a subspecies raised to species", () => {
  test("is followed when the result lives in Taiwan", () => {
    const idx = index([BADGER_ABROAD, BADGER_HERE]);
    assert.equal(
      elevatedSubspecies(idx, "Melogale moschata subaurantiaca").id,
      BADGER_HERE.id,
    );
  });

  test("is refused when it does not", () => {
    // Outside Taiwan the same combination can name a different animal, and the
    // crosswalk must not carry a guess.
    const idx = index([
      { id: 9, taicol_id: "t9", scientific_name: "Melogale subaurantiaca", is_in_taiwan: false },
    ]);
    assert.equal(elevatedSubspecies(idx, "Melogale moschata subaurantiaca"), null);
  });

  test("is refused for a plain binomial", () => {
    const idx = index([DOG]);
    assert.equal(elevatedSubspecies(idx, "Canis familiaris"), null);
  });
});
