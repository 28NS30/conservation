/**
 * Unit tests for packages/shared — the pure logic the map, the API and the
 * importers all agree on.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isInTaiwanBounds,
  filterToQuery,
  aggregationCellMeters,
  requiresClassification,
  reportSubmissionSchema,
  TILE_AGGREGATION_MAX_ZOOM,
  CATEGORIES,
  CATEGORY_KEYS,
  COLLECTIONS,
  COLLECTION_KEYS,
  RECORD_CONDITIONS,
  mapFilterSchema,
  pageFilter,
  selectionFor,
} from "@conservation/shared";

describe("Taiwan bounds", () => {
  test("accepts the main island", () => {
    assert.ok(isInTaiwanBounds(121.56, 25.03), "Taipei");
    assert.ok(isInTaiwanBounds(120.3, 22.63), "Kaohsiung");
  });

  test("accepts the outlying islands", () => {
    // These sit far west near Fujian; a naive main-island box excludes them.
    assert.ok(isInTaiwanBounds(118.32, 24.43), "Kinmen 金門");
    assert.ok(isInTaiwanBounds(119.95, 26.16), "Matsu 馬祖");
    assert.ok(isInTaiwanBounds(119.57, 23.57), "Penghu 澎湖");
    assert.ok(isInTaiwanBounds(121.53, 22.04), "Orchid Island 蘭嶼");
  });

  test("rejects points outside", () => {
    assert.ok(!isInTaiwanBounds(139.69, 35.68), "Tokyo");
    assert.ok(!isInTaiwanBounds(114.17, 22.32), "Hong Kong");
    assert.ok(!isInTaiwanBounds(0, 0), "null island");
  });
});

describe("filterToQuery", () => {
  test("omits empty filters", () => {
    assert.equal(filterToQuery({}), "");
  });

  test("serialises each filter", () => {
    const q = new URLSearchParams(
      filterToQuery({ collection: "invasive", condition: "alive", from: "2024-01-01" }),
    );
    assert.equal(q.get("collection"), "invasive");
    assert.equal(q.get("condition"), "alive");
    assert.equal(q.get("from"), "2024-01-01");
  });

  test("distinct filters produce distinct strings", () => {
    // The query string doubles as the CDN cache key, so collisions would serve
    // one filter's tiles for another.
    const a = filterToQuery({ collection: "roadkill" });
    const b = filterToQuery({ collection: "invasive" });
    assert.notEqual(a, b);
  });

  test("never writes the retired `group` key", () => {
    // The tile endpoint refuses `group`, so a client that still wrote it would
    // get a 400 for every tile — an empty map that looks like no data.
    for (const c of COLLECTION_KEYS)
      assert.doesNotMatch(filterToQuery({ collection: c }), /\bgroup=/);
  });
});

describe("collections", () => {
  // Three databases over one table. They overlap by design — a live invasive
  // animal is wildlife and invasive — so these pin what each one selects
  // rather than that they partition anything.

  test("roadkill is the roadkill page's two categories, any species", () => {
    assert.deepEqual(selectionFor({ collection: "roadkill" }), {
      categories: ["roadkill", "injured"],
      invasiveOnly: false,
    });
  });

  test("wildlife is every live animal, including those filed as invasive", () => {
    // A report filed on the invasive page is still a live animal. Leaving
    // `invasive` out of wildlife would drop exactly the records the team
    // asked to see marked inside it.
    assert.deepEqual(selectionFor({ collection: "wildlife" }), {
      categories: ["sighting", "invasive"],
      invasiveOnly: false,
    });
  });

  test("invasive is the species' own flag, in any category", () => {
    // Dead invasive animals count (the team's default for Q3). A category
    // list here would make the collection a property of the form again.
    assert.deepEqual(selectionFor({ collection: "invasive" }), {
      categories: null,
      invasiveOnly: true,
    });
  });

  test("the invasive collection splits into alive and dead", () => {
    assert.deepEqual(selectionFor({ collection: "invasive", condition: "alive" }), {
      categories: ["sighting", "invasive"],
      invasiveOnly: true,
    });
    assert.deepEqual(selectionFor({ collection: "invasive", condition: "dead" }), {
      categories: ["roadkill", "injured"],
      invasiveOnly: true,
    });
  });

  test("alive and dead cover every stored category, once each", () => {
    const all = [
      ...RECORD_CONDITIONS.alive.categories,
      ...RECORD_CONDITIONS.dead.categories,
    ].sort();
    assert.deepEqual(all, [...CATEGORY_KEYS].sort());
  });

  test("every category reaches roadkill or wildlife, so none is invisible", () => {
    const reached = new Set(
      ["roadkill", "wildlife"].flatMap((c) => COLLECTIONS[c].categories),
    );
    for (const k of CATEGORY_KEYS) assert.ok(reached.has(k), `${k} is in no collection`);
  });

  test("no filter selects everything", () => {
    assert.deepEqual(selectionFor({}), { categories: null, invasiveOnly: false });
  });
});

describe("the map filter schema", () => {
  test("a condition outside the invasive collection is refused", () => {
    // Anywhere else it is redundant or always empty, and a second spelling of
    // one filter is a second CDN key for the same tiles.
    for (const f of [
      { condition: "alive" },
      { collection: "roadkill", condition: "dead" },
      { collection: "wildlife", condition: "alive" },
    ])
      assert.equal(mapFilterSchema.safeParse(f).success, false, JSON.stringify(f));
    assert.equal(
      mapFilterSchema.safeParse({ collection: "invasive", condition: "dead" }).success,
      true,
    );
  });

  test("an unknown collection is refused", () => {
    assert.equal(mapFilterSchema.safeParse({ collection: "sighting" }).success, false);
  });
});

describe("old group= links on the pages", () => {
  // Shared maps and bookmarks carry `group=`. The pages read it as the
  // collection it meant; only the tile endpoint refuses it.
  for (const [group, collection] of [
    ["roadkill", "roadkill"],
    ["sighting", "wildlife"],
    ["invasive", "invasive"],
  ])
    test(`group=${group} opens the ${collection} collection`, () => {
      assert.deepEqual(pageFilter({ group }), { collection });
    });

  test("the rest of the link survives", () => {
    assert.deepEqual(pageFilter({ group: "roadkill", taxonId: "28758", from: "2014-01-01" }), {
      collection: "roadkill",
      taxonId: 28758,
      from: "2014-01-01",
    });
  });

  test("collection wins when a link carries both", () => {
    assert.deepEqual(pageFilter({ group: "roadkill", collection: "invasive" }), {
      collection: "invasive",
    });
  });

  test("an unknown group is ignored, not guessed", () => {
    assert.deepEqual(pageFilter({ group: "pollution" }), {});
  });

  test("a stray condition is dropped, keeping the collection", () => {
    assert.deepEqual(pageFilter({ collection: "wildlife", condition: "dead" }), {
      collection: "wildlife",
    });
  });
});

describe("aggregationCellMeters", () => {
  test("halves with each zoom level", () => {
    for (let z = 3; z < 9; z++) {
      const ratio = aggregationCellMeters(z) / aggregationCellMeters(z + 1);
      assert.ok(Math.abs(ratio - 2) < 1e-9, `z${z}->z${z + 1} ratio was ${ratio}`);
    }
  });

  test("stays positive and finite across the aggregated range", () => {
    for (let z = 0; z <= TILE_AGGREGATION_MAX_ZOOM; z++) {
      const c = aggregationCellMeters(z);
      assert.ok(Number.isFinite(c) && c > 0, `bad cell size at z${z}: ${c}`);
    }
  });
});

describe("requiresClassification", () => {
  test("classifiable categories with a photo are held for identification", () => {
    for (const k of CATEGORY_KEYS.filter((c) => CATEGORIES[c].classifiable)) {
      assert.equal(requiresClassification(k, 1), true, k);
    }
  });

  test("non-classifiable categories never wait", () => {
    for (const k of CATEGORY_KEYS.filter((c) => !CATEGORIES[c].classifiable)) {
      assert.equal(requiresClassification(k, 3), false, k);
    }
  });

  test("no photo means nothing to classify", () => {
    assert.equal(requiresClassification("roadkill", 0), false);
  });
});

describe("reportSubmissionSchema", () => {
  const valid = {
    category: "roadkill",
    lng: 120.9,
    lat: 23.8,
    observedAt: new Date().toISOString(),
    clientNonce: crypto.randomUUID(),
    photoPaths: [],
  };

  test("accepts a well-formed submission", () => {
    assert.ok(reportSubmissionSchema.safeParse(valid).success);
  });

  test("rejects a future observation date", () => {
    const r = reportSubmissionSchema.safeParse({ ...valid, observedAt: "2099-01-01T00:00:00Z" });
    assert.equal(r.success, false);
  });

  test("rejects an implausibly old date", () => {
    const r = reportSubmissionSchema.safeParse({ ...valid, observedAt: "1900-01-01T00:00:00Z" });
    assert.equal(r.success, false);
  });

  test("rejects an unknown category", () => {
    assert.equal(reportSubmissionSchema.safeParse({ ...valid, category: "nope" }).success, false);
  });

  test("rejects a non-uuid nonce", () => {
    // The nonce is the idempotency key; a junk value would allow duplicates.
    assert.equal(reportSubmissionSchema.safeParse({ ...valid, clientNonce: "abc" }).success, false);
  });

  test("rejects out-of-range coordinates", () => {
    assert.equal(reportSubmissionSchema.safeParse({ ...valid, lat: 200 }).success, false);
  });
});
