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
    const q = new URLSearchParams(filterToQuery({ category: "roadkill", from: "2024-01-01" }));
    assert.equal(q.get("category"), "roadkill");
    assert.equal(q.get("from"), "2024-01-01");
  });

  test("distinct filters produce distinct strings", () => {
    // The query string doubles as the CDN cache key, so collisions would serve
    // one filter's tiles for another.
    const a = filterToQuery({ category: "roadkill" });
    const b = filterToQuery({ category: "invasive" });
    assert.notEqual(a, b);
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
