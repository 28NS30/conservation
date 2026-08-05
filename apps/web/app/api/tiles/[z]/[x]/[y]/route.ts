import { asPublic } from "@/lib/db";
import {
  mapFilterSchema,
  TILE_AGGREGATION_MAX_ZOOM,
  aggregationCellMeters,
} from "@conservation/shared";

/**
 * Mapbox Vector Tiles generated in PostGIS.
 *
 *   GET /api/tiles/{z}/{x}/{y}?category=roadkill&from=2024-01-01
 *
 * Two regimes:
 *   z <= 9  aggregated grid cells carrying a `weight` — a country-zoom tile
 *           returns a few hundred features instead of tens of thousands of points.
 *   z >= 10 individual points, clickable.
 *
 * Reads `reports_public`, never `reports`: true coordinates of sensitive taxa are
 * not reachable from this path by construction.
 */

const MAX_ZOOM = 16;
/** Safety valve so a pathological viewport can't stream unbounded rows. */
const POINT_LIMIT = 20_000;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z: zs, x: xs, y: ys } = await ctx.params;
  const z = Number(zs), x = Number(xs), y = Number(ys);

  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return new Response("bad tile coordinate", { status: 400 });
  }
  if (z < 0 || z > MAX_ZOOM) return new Response("zoom out of range", { status: 400 });
  const max = 2 ** z;
  if (x < 0 || x >= max || y < 0 || y >= max) {
    return new Response("tile out of range", { status: 400 });
  }

  const parsed = mapFilterSchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) return new Response("bad filter", { status: 400 });
  const f = parsed.data;

  // Bound params are interpolated by the driver, never string-concatenated.
  const category = f.category ?? null;
  const taxonId = f.taxonId ?? null;
  const from = f.from ?? null;
  const to = f.to ?? null;

  const aggregated = z <= TILE_AGGREGATION_MAX_ZOOM;

  // Runs as `web_anon`, which cannot reach the `reports` base table at all —
  // tiles are structurally incapable of carrying a true sensitive coordinate.
  const rows = await asPublic(async (tx) => {
    if (aggregated) {
      const cell = aggregationCellMeters(z);
      // Cells are emitted as SQUARES, not centroids, because the map draws them
      // as discrete filled bins rather than smearing them through a heatmap
      // kernel. See HeatmapView.tsx for why that changed.
      //
      // ST_SnapToGrid rounds to nearest, so the snapped point is the cell's
      // *centre* and its extent is +/- cell/2. Verified, not assumed: with a grid
      // of 100, x=50 snaps to 0 and x=51 snaps to 100.
      //
      // The scan envelope is expanded by a full cell, and that is load-bearing.
      // A cell straddling a tile boundary must be counted from *all* its reports,
      // not just those inside this tile — otherwise the two neighbouring tiles
      // each draw the same square with a different partial weight, and it renders
      // as a visibly mis-coloured seam. Expanding by `cell` covers both the cell's
      // own half-width and the snap catchment radius on the far side.
      //
      // Buffer is 0 rather than 64 for the same reason: with a buffer, each tile
      // would carry an overlapping strip of its neighbour's polygons, and any
      // fill-opacity below 1 double-draws that strip as a dark band along every
      // tile edge. Clipping exactly at the boundary makes adjacent tiles abut.
      return tx<{ tile: Uint8Array | null }[]>`
      with env as (select st_tileenvelope(${z}, ${x}, ${y}) as e),
      cells as (
        select st_snaptogrid(r.geom_3857, ${cell}::float8) as pt,
               count(*)::int                      as weight
          from reports_public r, env
         where r.geom_3857 && st_expand(env.e, ${cell}::float8)
           and (${category}::text is null or r.category = ${category})
           and (${taxonId}::bigint is null or r.taxon_id = ${taxonId})
           and (${from}::date is null or r.observed_at >= ${from}::date)
           and (${to}::date   is null or r.observed_at <  (${to}::date + 1))
         group by 1
      )
      -- TWO layers in one tile.
      --
      -- An MVT is a concatenation of layers, so concatenating two ST_AsMVT
      -- results yields a valid tile. (Note: no backticks in here — this is inside
      -- a JS template literal, and one would silently truncate the query.)
      -- The map offers a toggle between filled bins and proportional
      -- dots, and shipping both geometries together means flipping it is instant
      -- and costs no extra fetch or CDN entry — at roughly +25 KB on a z6 tile.
      --
      -- The dots cannot be derived from the polygons on the client: MapLibre's
      -- circle layer renders a circle at every *vertex* of a polygon, so a square
      -- cell would draw four.
      select coalesce(
               (select st_asmvt(a, 'reports', 4096, 'geom')
                  from (
                    select st_asmvtgeom(
                             st_makeenvelope(
                               st_x(cells.pt) - ${cell}::float8 / 2, st_y(cells.pt) - ${cell}::float8 / 2,
                               st_x(cells.pt) + ${cell}::float8 / 2, st_y(cells.pt) + ${cell}::float8 / 2,
                               3857),
                             env.e, 4096, 0, true) as geom,
                           cells.weight
                      from cells, env
                  ) a
                 where a.geom is not null),
               ''::bytea)
             ||
             coalesce(
               (select st_asmvt(b, 'reports_dots', 4096, 'geom')
                  from (
                    -- Buffered, unlike the cells: a dot near the tile edge must
                    -- still draw its full circle rather than being sliced in half.
                    select st_asmvtgeom(cells.pt, env.e, 4096, 64, true) as geom,
                           cells.weight
                      from cells, env
                  ) b
                 where b.geom is not null),
               ''::bytea) as tile`;
    }

    return tx<{ tile: Uint8Array | null }[]>`
      with env as (select st_tileenvelope(${z}, ${x}, ${y}) as e)
      select st_asmvt(t, 'reports', 4096, 'geom') as tile
        from (
          select st_asmvtgeom(r.geom_3857, env.e, 4096, 64, true) as geom,
                 r.id::text            as id,
                 r.category            as category,
                 r.is_obscured         as obscured,
                 r.taxon_id            as taxon_id,
                 to_char(r.observed_at, 'YYYY-MM-DD') as observed_on,
                 1                     as weight
            from reports_public r, env
           where r.geom_3857 && env.e
             and (${category}::text is null or r.category = ${category})
             and (${taxonId}::bigint is null or r.taxon_id = ${taxonId})
             and (${from}::date is null or r.observed_at >= ${from}::date)
             and (${to}::date   is null or r.observed_at <  (${to}::date + 1))
           limit ${POINT_LIMIT}
        ) t`;
  });

  const tile = rows[0]?.tile;
  // An empty tile is a valid answer, but it must be a 200 with a zero-length body,
  // NOT a 204. MapLibre fetches tiles as array buffers and its handling of a
  // bodyless 204 varies by version — a source that receives one can stay
  // permanently "not loaded", which renders as a silently empty layer over a
  // perfectly healthy basemap. An empty 200 is unambiguous and just as cheap.
  if (!tile || tile.length === 0) {
    return new Response(new Uint8Array(0), {
      status: 200,
      headers: {
        "content-type": "application/vnd.mapbox-vector-tile",
        "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  }

  return new Response(new Uint8Array(tile), {
    status: 200,
    headers: {
      "content-type": "application/vnd.mapbox-vector-tile",
      // Filters live in the query string, so the CDN keys on them automatically.
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
