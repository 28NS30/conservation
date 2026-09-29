import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { asPublic } from "@/lib/db";
import {
  COLLECTIONS,
  filterToQuery,
  mapFilterSchema,
  selectionFor,
  TILE_AGGREGATION_MAX_ZOOM,
  aggregationCellMeters,
} from "@conservation/shared";

/**
 * Mapbox Vector Tiles generated in PostGIS.
 *
 *   GET /api/tiles/{z}/{x}/{y}?collection=roadkill&from=2024-01-01
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
const gz = promisify(gzip);

/**
 * Whether the client has explicitly refused gzip.
 *
 * No header at all means no preference, and gzip is acceptable (RFC 9110
 * §12.5.3). Only a header that gives gzip — or `*`, with gzip unlisted — a
 * weight of zero, or lists codings without gzip or `*`, is a refusal.
 */
function refusesGzip(header: string | null): boolean {
  if (header === null || header.trim() === "") return false;
  let gzip: number | undefined;
  let any: number | undefined;
  for (const part of header.split(",")) {
    const [coding, ...params] = part.trim().toLowerCase().split(";");
    const qParam = params.map((x) => x.trim()).find((x) => x.startsWith("q="));
    const q = qParam === undefined ? 1 : Number(qParam.slice(2));
    const weight = Number.isFinite(q) ? q : 0;
    if (coding === "gzip" || coding === "x-gzip") gzip = weight;
    else if (coding === "*") any = weight;
  }
  return (gzip ?? any ?? 0) <= 0;
}

/** The headers every tile response shares, empty or not. */
const TILE_HEADERS = {
  "content-type": "application/vnd.mapbox-vector-tile",
  // Filters live in the query string, so the CDN keys on them automatically.
  "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
};

/**
 * Point tiles, above TILE_AGGREGATION_MAX_ZOOM, carry each record's id and
 * published point. Cached like the rest, a record a moderator had just blurred
 * or rejected kept its old point under its id in the CDN for up to a day, and
 * the id leads to the record's page and the species now named on it (security
 * audit, 29 September 2026). Minutes, so a moderator's decision reaches the
 * map about as fast as the record page. Aggregated tiles carry counts per
 * cell, and keep the long cache.
 */
const POINT_TILE_CACHE = "public, max-age=0, s-maxage=120, stale-while-revalidate=120";
const tileHeaders = (aggregated: boolean) =>
  aggregated ? TILE_HEADERS : { ...TILE_HEADERS, "cache-control": POINT_TILE_CACHE };
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

  const params = new URL(req.url).searchParams;
  // `category` used to be this filter's name and took one stored category. It
  // was renamed `group`, so an old link would otherwise be silently ignored and
  // return every report — a filter that looks applied and is not.
  if (params.has("category"))
    return new Response("category was replaced by collection", { status: 400 });
  // And `group` was replaced by `collection`, which does not mean the same
  // thing: `group=invasive` matched the stored category and held nothing,
  // `collection=invasive` matches the species and holds every record of an
  // invasive animal, dead ones included. Tiles are cached by the CDN for an
  // hour and served stale for a day after that, keyed on the query string, so
  // redefining `group` in place would have left visitors looking at the old
  // empty tiles under the new meaning. A new name is a new cache key; the old
  // one is refused rather than answered, so nothing cached under it can be
  // mistaken for the new filter. /map and /reports still read `group=` links
  // (pageFilter in packages/shared) and ask for tiles by the new name.
  if (params.has("group"))
    return new Response("group was replaced by collection", { status: 400 });

  const parsed = mapFilterSchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) return new Response("bad filter", { status: 400 });
  const f = parsed.data;

  // Only the exact query the map builds is served: filterToQuery is what
  // tileUrl() uses on the client, so its output is the one canonical form. An
  // ignored key, a repeated key whose first value is discarded, another
  // spelling of the same id, or the same keys in another order would each
  // fetch a tile the CDN already holds under a key it has never seen.
  //
  // This keeps the cache to the URLs the site actually requests. It is NOT a
  // defence against deliberate load, and should not be mistaken for one: the
  // tile grid itself offers millions of legitimate, uncached URLs. And it
  // cannot see everything — Next.js strips any nxtP*/nxtI* key before this
  // handler runs, while the CDN still keys on the URL as sent.
  if (params.toString() !== filterToQuery(f))
    return new Response("tile query is not in canonical form", { status: 400 });

  // Bound params are interpolated by the driver, never string-concatenated.
  //
  // A collection is a set of stored categories — `roadkill` means roadkill or
  // injured — and, for `invasive`, the species' own flag. selectionFor() is the
  // one reading of it the list and the hub pages share, so the map cannot
  // count a different set from the page a reader checks it against.
  //
  // `not invasiveOnly or is_invasive` costs nothing when the flag is false:
  // the OR stops at its first true operand, so the column is never computed
  // for the other two collections or for an unfiltered map.
  const { categories, invasiveOnly } = selectionFor(f);
  const taxonId = f.taxonId ?? null;
  const from = f.from ?? null;
  const to = f.to ?? null;

  const aggregated = z <= TILE_AGGREGATION_MAX_ZOOM;

  // Every cell also carries which of the three map types dominates it, so the
  // map can colour by type as well as by density. See MAP_TYPES: dead or
  // injured first, whatever the species, then the species decides between a
  // live invasive animal and any other. Built from COLLECTIONS rather than
  // written out, because a category missing from this CASE would colour as
  // the wrong type forever and look like data rather than like a bug.
  //
  // The CASE stops at its first match, so `is_invasive` is only computed for
  // live records. Every record today is roadkill, and the default map pays
  // nothing for it.
  const dead = COLLECTIONS.roadkill.categories.map((c) => `'${c}'`).join(",");
  const mapTypeOf = `case when r.category in (${dead}) then 'roadkill'
                          when r.is_invasive then 'invasive'
                          else 'wildlife' end`;

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
      by_group as (
        select st_snaptogrid(r.geom_3857, ${cell}::float8) as pt,
               ${tx.unsafe(mapTypeOf)}                     as grp,
               count(*)::int                               as n
          from reports_public r
         -- The envelope inline rather than through the env CTE. Joined, the
         -- planner cannot see it as a constant and reads far more of the table;
         -- inline, the same tile touches about a tenth of the buffers. Output
         -- verified byte-identical.
         where r.geom_3857 && st_expand(st_tileenvelope(${z}, ${x}, ${y}), ${cell}::float8)
           and (${categories}::text[] is null or r.category = any(${categories}))
           and (not ${invasiveOnly}::boolean or r.is_invasive)
           and (${taxonId}::bigint is null or r.taxon_id = ${taxonId})
           and (${from}::date is null or r.observed_at >= (${from}::date::timestamp at time zone 'Asia/Taipei'))
           and (${to}::date   is null or r.observed_at <  ((${to}::date + 1)::timestamp at time zone 'Asia/Taipei'))
         group by 1, 2
      ),
      cells as (
        select pt,
               sum(n)::int                                as weight,
               (array_agg(grp order by n desc, grp))[1]   as top_group,
               -- How lopsided the cell is. A cell that is half roadkill and half
               -- sightings has no colour that is honest, so the client draws it
               -- neutral rather than picking the winner by one report.
               (max(n)::float8 / sum(n))                  as top_share
          from by_group
         group by pt
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
                           cells.weight, cells.top_group, cells.top_share
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
                           cells.weight, cells.top_group, cells.top_share
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
                 -- What the point is drawn as: its category, except that the
                 -- species decides between the two live ones, so a live
                 -- invasive animal is marked invasive whichever page it was
                 -- filed on. The same rule as the cells' type, keeping the
                 -- stored category's own distinction between dead and injured.
                 case when r.category in (${tx.unsafe(dead)}) then r.category
                      when r.is_invasive then 'invasive'
                      else 'sighting' end as kind,
                 r.is_obscured         as obscured,
                 r.taxon_id            as taxon_id,
                 to_char(r.observed_at at time zone 'Asia/Taipei', 'YYYY-MM-DD') as observed_on,
                 1                     as weight
            from reports_public r, env
           where r.geom_3857 && env.e
             and (${categories}::text[] is null or r.category = any(${categories}))
             and (not ${invasiveOnly}::boolean or r.is_invasive)
             and (${taxonId}::bigint is null or r.taxon_id = ${taxonId})
             and (${from}::date is null or r.observed_at >= (${from}::date::timestamp at time zone 'Asia/Taipei'))
             and (${to}::date   is null or r.observed_at <  ((${to}::date + 1)::timestamp at time zone 'Asia/Taipei'))
           limit ${POINT_LIMIT}
        ) t`;
  });

  const tile = rows[0]?.tile;
  // An empty tile is a valid answer, but it must be a 200 with a zero-length body,
  // NOT a 204. MapLibre fetches tiles as array buffers and its handling of a
  // bodyless 204 varies by version — a source that receives one can stay
  // permanently "not loaded", which renders as a silently empty layer over a
  // perfectly healthy basemap. An empty 200 is unambiguous and just as cheap.
  //
  // Never gzipped: an empty buffer compresses to twenty bytes, and "zero-length"
  // is the whole contract. No Vary either: an empty body is the same in every
  // encoding, so there is nothing for separate cache entries to separate.
  if (!tile || tile.length === 0) {
    return new Response(new Uint8Array(0), { status: 200, headers: tileHeaders(aggregated) });
  }

  // Compressed here because nothing else will. Vercel compresses the types it
  // recognises, and application/vnd.mapbox-vector-tile is not one of them, so
  // tiles went out raw: the default desktop view was 212 KB on the wire and is
  // about 36 KB gzipped. MapLibre fetches through the browser, which decodes it.
  //
  // Gzipped for every client that has not refused it, with `Vary:
  // accept-encoding`. The Vary is load-bearing, and removing it was tried.
  //
  // Vercel's CDN transcodes: a client that sends no Accept-Encoding, or
  // `identity`, is handed a decompressed body — and without Vary that
  // decompressed copy is what gets cached and served to every browser after it.
  // Measured on production: a tile whose first request came from a client with
  // no header went on to serve 39 KB raw to Chrome and Safari, where the
  // gzipped copy is 6.5 KB, for as long as the cache held it. One crawler or
  // curl was enough.
  //
  // The price of Vary is that the CDN keys on the exact header string, so a
  // tile is cached once per distinct value. In practice that is two: Chrome,
  // Edge and Firefox send `gzip, deflate, br, zstd`; Safari sends
  // `gzip, deflate, br`.
  if (refusesGzip(req.headers.get("accept-encoding"))) {
    return new Response(new Uint8Array(tile), {
      status: 200,
      headers: {
        ...tileHeaders(aggregated),
        "cache-control": "private, no-store",
        vary: "accept-encoding",
      },
    });
  }

  return new Response(new Uint8Array(await gz(tile, { level: 6 })), {
    status: 200,
    headers: {
      ...tileHeaders(aggregated),
      "content-encoding": "gzip",
      vary: "accept-encoding",
    },
  });
}
