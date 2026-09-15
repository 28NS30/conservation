/**
 * Tile endpoint contract.
 *
 * Requires the dev server (`npm run dev`). Several of these encode bugs that
 * actually shipped and were painful to find — notably the 204-vs-200 empty-tile
 * behaviour, which left MapLibre's source permanently "not loaded" while the
 * basemap rendered perfectly.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { sql, BASE_URL } from "./helpers.mjs";
import {
  aggregationCellMeters,
  TILE_AGGREGATION_MAX_ZOOM,
} from "@conservation/shared";

after(() => sql.end());

/** A z6 tile covering Taiwan. */
const Z6 = { z: 6, x: 53, y: 27 };

async function getTile(path) {
  const res = await fetch(`${BASE_URL}/api/tiles/${path}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return {
    status: res.status,
    bytes: buf.length,
    buf,
    contentType: res.headers.get("content-type"),
  };
}

before(async () => {
  const res = await fetch(BASE_URL).catch(() => null);
  if (!res)
    throw new Error(
      `dev server not reachable at ${BASE_URL} — run \`npm run dev\``,
    );
});

describe("aggregation loses no records", () => {
  test("cell weights sum exactly to the underlying report count", async () => {
    const [row] = await sql`
      with env as (select st_tileenvelope(${Z6.z}, ${Z6.x}, ${Z6.y}) as e),
      cells as (
        select st_snaptogrid(r.geom_3857, 40075016.686/2^${Z6.z}/64) as pt, count(*)::int w
          from reports_public r, env where r.geom_3857 && env.e group by 1
      )
      select (select count(*) from reports_public r, env where r.geom_3857 && env.e)::int as direct,
             (select coalesce(sum(w),0) from cells)::int as via_cells,
             (select count(*) from cells)::int as n_cells`;
    assert.equal(
      row.via_cells,
      row.direct,
      "aggregation must conserve the total",
    );
    assert.ok(
      row.n_cells < row.direct,
      "aggregation should actually reduce feature count",
    );
  });
});

describe("MVT structure", () => {
  test("z6 returns aggregated cell polygons carrying `weight`", async () => {
    const { status, buf } = await getTile(`${Z6.z}/${Z6.x}/${Z6.y}`);
    assert.equal(status, 200);
    const tile = new VectorTile(new PbfReader(buf));
    // The layer names must match `source-layer` in HeatmapView, or MapLibre
    // silently renders nothing. Aggregated tiles carry two: filled cells and the
    // dot centroids the display toggle switches to.
    assert.deepEqual(Object.keys(tile.layers).sort(), [
      "reports",
      "reports_dots",
    ]);
    const layer = tile.layers.reports;
    assert.equal(layer.extent, 4096);
    assert.ok(layer.length > 0);
    const f = layer.feature(0);
    // Polygons, not points. The map draws each aggregation cell as a filled
    // square rather than feeding a centroid into a heatmap kernel — see
    // DENSITY_CLASSES in packages/shared for why that changed.
    assert.equal(f.type, 3, "aggregated features must be polygons");
    assert.ok(
      typeof f.properties.weight === "number",
      "aggregated cells must carry `weight`",
    );

    // A square: five points, first and last coincident.
    const ring = f.loadGeometry()[0];
    assert.equal(
      ring.length,
      5,
      "each cell should be a closed 4-corner square",
    );
    assert.equal(ring[0].x, ring.at(-1).x);
    assert.equal(ring[0].y, ring.at(-1).y);
  });

  test("aggregated tiles carry both a polygon and a dot layer", async () => {
    // The map toggles between filled bins and proportional dots. Both geometries
    // ride in the same tile so the switch needs no refetch — an MVT is just a
    // concatenation of layers. The dots cannot be derived client-side: MapLibre
    // draws a circle at every vertex of a polygon, so a square would give four.
    const { buf } = await getTile(`${Z6.z}/${Z6.x}/${Z6.y}`);
    const tile = new VectorTile(new PbfReader(buf));
    assert.deepEqual(
      Object.keys(tile.layers).sort(),
      ["reports", "reports_dots"],
      "aggregated tiles must carry both layers",
    );

    const cells = tile.layers.reports;
    const dots = tile.layers.reports_dots;
    assert.equal(cells.feature(0).type, 3, "reports must be polygons");
    assert.equal(dots.feature(0).type, 1, "reports_dots must be points");

    const weights = (layer) =>
      [...Array(layer.length).keys()].map(
        (i) => layer.feature(i).properties.weight,
      );
    const cw = weights(cells);
    const dw = weights(dots);
    assert.ok(
      cw.every((w) => typeof w === "number" && w > 0),
      "cells carry a positive weight",
    );
    assert.ok(
      dw.every((w) => typeof w === "number" && w > 0),
      "dots carry a positive weight",
    );

    // Dots are emitted with a 64px buffer so an edge dot draws its whole circle;
    // cells are clipped exactly at the boundary. So dots >= cells, never fewer.
    assert.ok(
      dots.length >= cells.length,
      `dots (${dots.length}) should not be fewer than cells (${cells.length})`,
    );
    // Both describe the same underlying aggregation, so the busiest cell agrees.
    assert.equal(
      Math.max(...cw),
      Math.max(...dw),
      "both layers describe the same cells",
    );
  });

  test("high zoom returns individual points, not aggregates", async () => {
    const [row] = await sql`
      select st_x(geom_3857) x, st_y(geom_3857) y from reports_public limit 1`;
    // Derived from the constant, not hardcoded: this test previously pinned z12
    // and started failing the moment aggregation was extended past it.
    const z = TILE_AGGREGATION_MAX_ZOOM + 1;
    const n = 2 ** z;
    const tx = Math.floor(((Number(row.x) + 20037508.34) / 40075016.68) * n);
    const ty = Math.floor(((20037508.34 - Number(row.y)) / 40075016.68) * n);
    const { status, buf } = await getTile(`${z}/${tx}/${ty}`);
    assert.equal(status, 200);
    const tile = new VectorTile(new PbfReader(buf));
    const layer = tile.layers.reports;
    assert.ok(layer && layer.length > 0, `expected point features at z${z}`);
    const f = layer.feature(0);
    assert.ok(
      "id" in f.properties,
      "point tiles should carry a report id for click handling",
    );
  });
});

describe("empty tiles", () => {
  test("return 200 with a zero-length body, never 204", async () => {
    // Open ocean far from any report.
    const { status, bytes, contentType } = await getTile("7/105/53");
    assert.equal(
      status,
      200,
      "MapLibre handles a bodyless 204 inconsistently; must be 200",
    );
    assert.equal(bytes, 0);
    assert.match(contentType ?? "", /vector-tile/);
  });
});

/** Cell size at the z6 test tile, mirroring aggregationCellMeters(6). */
const CELL_M_Z6 = aggregationCellMeters(6);

describe("filters discriminate", () => {
  test("a report type with no data yields an empty tile", async () => {
    // Every one of the 46,334 records is imported roadkill, so any other live
    // group is empty. This used to ask for `pollution`, which was retired in
    // 0008 and is now rejected as unknown — a 400, not an empty 200.
    const { status, bytes } = await getTile(
      `${Z6.z}/${Z6.x}/${Z6.y}?group=sighting`,
    );
    assert.equal(status, 200);
    assert.equal(bytes, 0);
  });

  test("the roadkill group carries injured reports too", async () => {
    // One button on the form, two stored categories. A map that filtered to
    // `roadkill` alone would hide every injured animal behind a toggle claiming
    // to show them — and nothing else would notice, because every seeded record
    // is roadkill. So one is planted, committed (the endpoint reads on its own
    // connection and could not see a transaction), and removed afterwards.
    const [{ id }] = await sql`
      insert into reports (category, location, location_public, observed_at,
                           taxon_source, status, source)
      values ('injured',
              st_setsrid(st_makepoint(121.0, 23.7), 4326)::geography,
              st_setsrid(st_makepoint(121.0, 23.7), 4326)::geography,
              now(), 'unknown', 'published', 'user')
      returning id`;
    try {
      const high = { z: 12, x: 3424, y: 1770 };
      const [{ n }] = await sql`
        select count(*)::int as n from reports_public
         where category = 'injured'
           and geom_3857 && st_tileenvelope(${high.z}, ${high.x}, ${high.y})`;
      assert.ok(n > 0, "the planted report must fall inside the test tile");

      const roadkill = await getTile(`${high.z}/${high.x}/${high.y}?group=roadkill`);
      const sighting = await getTile(`${high.z}/${high.x}/${high.y}?group=sighting`);
      assert.ok(roadkill.bytes > 0, "the roadkill group must include it");
      assert.equal(sighting.bytes, 0, "no other group may");
    } finally {
      await sql`delete from reports where id = ${id}`;
    }
  });

  test("a future date range yields an empty tile", async () => {
    const { bytes } = await getTile(`${Z6.z}/${Z6.x}/${Z6.y}?from=2099-01-01`);
    assert.equal(bytes, 0);
  });

  test("a date filter shrinks the tile and matches ground truth", async () => {
    // Derived from the data, so this works against both the CI fixture and a
    // fully seeded dev database.
    const [{ cutoff }] = await sql`
      select to_char(
        percentile_disc(0.5) within group (order by observed_at), 'YYYY-MM-DD') as cutoff
        from reports_public`;

    const full = await getTile(`${Z6.z}/${Z6.x}/${Z6.y}`);
    const filtered = await getTile(`${Z6.z}/${Z6.x}/${Z6.y}?from=${cutoff}`);
    assert.ok(
      filtered.bytes > 0 && filtered.bytes < full.bytes,
      `filtered tile (${filtered.bytes}B) should be smaller than full (${full.bytes}B)`,
    );

    // Weights are counted over the tile envelope expanded by one cell, so a cell
    // straddling the boundary carries its FULL count in both neighbouring tiles
    // rather than a partial count in each. That is deliberate: without it the two
    // tiles would draw the same square in two different colours, which renders as
    // a mis-coloured seam. The consequence is that a tile's weights sum to
    // slightly more than the reports strictly inside it — bounded by the reports
    // in the one-cell collar around it.
    const [row] = await sql`
      with env as (select st_tileenvelope(${Z6.z}, ${Z6.x}, ${Z6.y}) as e)
      select count(*) filter (where r.geom_3857 && env.e)::int as inside,
             count(*)::int as inside_with_collar
        from reports_public r, env
       where r.geom_3857 && st_expand(env.e, ${CELL_M_Z6}::float8)
         and r.observed_at >= ${cutoff}::date`;
    const tile = new VectorTile(new PbfReader(filtered.buf));
    const total = [...Array(tile.layers.reports.length).keys()].reduce(
      (s, i) => s + tile.layers.reports.feature(i).properties.weight,
      0,
    );
    assert.ok(
      total >= row.inside && total <= row.inside_with_collar,
      `tile weights (${total}) must lie between the reports inside the tile ` +
        `(${row.inside}) and those within a one-cell collar (${row.inside_with_collar})`,
    );
  });
});

describe("input validation", () => {
  for (const [path, why] of [
    ["6/999/999", "tile index out of range for zoom"],
    ["99/0/0", "zoom out of range"],
    ["abc/1/1", "non-numeric coordinate"],
  ]) {
    test(`rejects ${why}`, async () => {
      const { status } = await getTile(path);
      assert.equal(status, 400);
    });
  }

  test("rejects an unknown report type", async () => {
    const { status } = await getTile(
      `${Z6.z}/${Z6.x}/${Z6.y}?group=notagroup`,
    );
    assert.equal(status, 400);
  });

  test("the filter's old name is refused rather than ignored", async () => {
    // `category` took one stored category and is now `group`, taking the three
    // the form offers. Left to zod it would be stripped as an unknown key and
    // the tile would come back unfiltered — a filter that looks applied.
    const { status } = await getTile(
      `${Z6.z}/${Z6.x}/${Z6.y}?category=roadkill`,
    );
    assert.equal(status, 400);
  });
});
