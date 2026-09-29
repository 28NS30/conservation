/**
 * Where a record's location could still be found after the site blurred it,
 * held to what the security audit of 29 September 2026 found: a point tile
 * serving the old point for a day after a moderator blurred it, the public
 * test fixture carrying true points of blurred records, a fixture generator
 * that would take a person's report, and a remap that undid moderators'
 * species fixes and loosened their blur.
 *
 *   node --test test/data-exposure.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, BASE_URL } from "./helpers.mjs";
import { TILE_AGGREGATION_MAX_ZOOM } from "@conservation/shared";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const ROOT = join(WEB, "..", "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const up = async () => Boolean(await fetch(BASE_URL).catch(() => null));

/** The tile containing a point, at a zoom. */
function tileOf(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return `${z}/${x}/${y}`;
}

describe("a point tile follows a moderator's decision within minutes", () => {
  test("point tiles are cached for two minutes, aggregated tiles for an hour", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const point = await fetch(`${BASE_URL}/api/tiles/${tileOf(121.5, 25.03, TILE_AGGREGATION_MAX_ZOOM + 2)}`);
    assert.equal(point.status, 200);
    assert.match(point.headers.get("cache-control") ?? "", /s-maxage=120, stale-while-revalidate=120/);
    const cell = await fetch(`${BASE_URL}/api/tiles/${tileOf(121.5, 25.03, 7)}`);
    assert.equal(cell.status, 200);
    assert.match(cell.headers.get("cache-control") ?? "", /s-maxage=3600/);
  });
});

describe("the public test fixture", () => {
  const seed = read("supabase", "seed-test.sql");
  const ROW =
    /\('([0-9a-f-]{36})'::uuid, '[a-z_]+', st_setsrid\(st_makepoint\(([-0-9.e]+),([-0-9.e]+)\),4326\)::geography/g;
  const rows = [...seed.matchAll(ROW)].map((m) => ({ id: m[1], lng: Number(m[2]), lat: Number(m[3]) }));

  test("is read whole", () => {
    assert.ok(rows.length > 500, `only ${rows.length} rows parsed`);
  });

  test("carries no true point of a record the site blurs", async (t) => {
    // Checked against this database's own rule for each row: where it blurs,
    // the fixture's point must be the centre of the blur cell.
    const blurred = await sql`
      select r.id::text, precision_cell_deg(r.location_precision) as c
        from reports r
       where r.id = any(${rows.map((r) => r.id)}::uuid[])
         and r.location_precision <> 'exact'
         and precision_cell_deg(r.location_precision) > 0`;
    if (blurred.length === 0) return t.skip("none of the fixture's blurred rows are in this database");
    const byId = new Map(rows.map((r) => [r.id, r]));
    const off = blurred.filter(({ id, c }) => {
      const r = byId.get(id);
      const centre = (v) => Math.floor(v / c) * c + c / 2;
      return Math.abs(r.lng - centre(r.lng)) > 1e-6 || Math.abs(r.lat - centre(r.lat)) > 1e-6;
    });
    assert.deepEqual(off.map((r) => r.id), [], "these blurred rows carry a point other than their cell's centre");
  });

  test("its generator takes only published GBIF records, from a local database", () => {
    const gen = read("scripts", "make-test-fixture.ts");
    assert.equal(
      (gen.match(/source = 'gbif' and (?:r\.)?status = 'published' and not (?:r\.)?is_test/g) ?? []).length,
      2,
      "both the sample and the 石虎 top-up must be restricted",
    );
    assert.match(gen, /reads a local database only/);
    assert.match(gen, /refusing to write/);
    assert.match(gen, /floor\(st_x\(e\.location::geometry\) \/ c\.deg\) \* c\.deg \+ c\.deg \/ 2/);
  });
});

describe("the GBIF remap leaves a person's identification alone, and only tightens", () => {
  test("the script", () => {
    const src = read("scripts", "remap-gbif-taxa.ts");
    assert.match(src, /and coalesce\(taxon_source, 'imported'\) not in \('expert', 'user'\)`;/);
    assert.match(src, /and coalesce\(r\.taxon_source, 'imported'\) not in \('expert', 'user'\)/);
    assert.match(src, /precision_override = stricter_precision\(\s+coalesce\(m\.keep_blur, r\.precision_override\), r\.location_precision\)/);
  });

  test("every update in the committed SQL", () => {
    const remap = read("scripts", "taxon-remap.sql");
    const updates = remap.split("update reports set").slice(1);
    assert.ok(updates.length > 100);
    for (const u of updates) {
      const stmt = u.slice(0, u.indexOf(";"));
      assert.match(stmt, /coalesce\(taxon_source, 'imported'\) not in \('expert', 'user'\)/);
      assert.match(stmt, /precision_override = stricter_precision\(/);
    }
  });
});
