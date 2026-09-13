import { asPublic } from "@/lib/db";

/**
 * Taiwan, drawn from every published record.
 *
 * The front page needs an image and the project has no photographs — not one
 * row in report_photos, because TaiRON publishes none to GBIF and nobody has
 * submitted a report. Every conventional move for a conservation site assumes a
 * big animal photograph, so the only picture available is the corpus itself:
 * 46,334 records aggregated to 500 m cells, which resolve into the road network
 * of Taiwan. It is the one image on this site that no stock library contains and
 * no other project could copy.
 *
 * Served as its own file rather than inlined: 16,700 cells is ~140 KB of markup,
 * which would land in the HTML of every page load. As a file the browser caches
 * it, and the whole page ships no client JavaScript.
 *
 * SPLIT FRAME. Kinmen sits 2.1 degrees west of the main island and Matsu a
 * degree north of its tip, so one honest full-extent frame is more than half
 * empty ocean with Taiwan pushed into a corner. The 2,009 records on Kinmen,
 * Matsu and Penghu get a separate inset at their own scale instead — every
 * record is represented, and neither frame is mostly sea.
 */
export const revalidate = 86400;

const MAIN = { w: 119.98, e: 122.1, s: 21.75, n: 25.35 };
const CELL_M = 500;

/**
 * Web Mercator, in radians on BOTH axes.
 *
 * Getting this wrong is subtle and total: with longitude left in degrees and
 * latitude in Mercator units the two axes are ~57x apart, and the island renders
 * as a 900x29 smear rather than a country.
 */
const mercY = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const mercX = (lng: number) => (lng * Math.PI) / 180;

type Cell = { x: number; y: number; n: number };

function project(
  cells: Cell[],
  box: { w: number; e: number; s: number; n: number },
  width: number,
) {
  const x0 = mercX(box.w);
  const x1 = mercX(box.e);
  const y0 = mercY(box.s);
  const y1 = mercY(box.n);
  const height = Math.round((width * (y1 - y0)) / (x1 - x0));
  const sx = width / (x1 - x0);
  const sy = height / (y1 - y0);
  return {
    height,
    points: cells.map((c) => ({
      px: (mercX(c.x) - x0) * sx,
      py: height - (mercY(c.y) - y0) * sy,
      n: c.n,
    })),
  };
}

export async function GET() {
  const rows = await asPublic(
    (tx) => tx<{ lng: number; lat: number; n: number }[]>`
      select avg(st_x(location_public::geometry))::float8 as lng,
             avg(st_y(location_public::geometry))::float8 as lat,
             count(*)::int as n
        from reports_public
       group by floor(st_x(geom_3857) / ${CELL_M})::int,
                floor(st_y(geom_3857) / ${CELL_M})::int`,
  );

  const offshore = (c: { lng: number; lat: number }) =>
    c.lng < 119.0 || c.lat > 25.6 || (c.lng < 119.9 && c.lat < 24.0);

  const main = rows
    .filter((r) => !offshore(r))
    .map((r) => ({ x: r.lng, y: r.lat, n: r.n }));
  const off = rows
    .filter(offshore)
    .map((r) => ({ x: r.lng, y: r.lat, n: r.n }));

  const W = 900;
  const m = project(main, MAIN, W);

  // The inset gets its own box, padded so nothing sits on the border.
  const ob = {
    w: Math.min(...off.map((c) => c.x)) - 0.08,
    e: Math.max(...off.map((c) => c.x)) + 0.08,
    s: Math.min(...off.map((c) => c.y)) - 0.08,
    n: Math.max(...off.map((c) => c.y)) + 0.08,
  };
  const IW = 190;
  const i = project(off, ob, IW);

  /*
   * Three weights rather than a continuous ramp: at 500 m the long tail is all
   * ones, and a ramp renders as uniform grey.
   *
   * Opacity lives on the group; the radius cannot. `r` is a geometry attribute
   * and is not inherited from a <g>, so hoisting it there rendered a page with
   * nothing on it but the inset's border — every circle had no radius at all.
   */
  const R = [0.95, 1.35, 1.9];
  const O = [0.5, 0.72, 0.95];
  const band = (n: number) => (n >= 8 ? 2 : n >= 3 ? 1 : 0);
  const layer = (
    pts: { px: number; py: number; n: number }[],
    b: number,
    scale = 1,
  ) => {
    const c = pts
      .filter((p) => band(p.n) === b)
      .map(
        (p) =>
          `<circle cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="${(R[b] * scale).toFixed(2)}"/>`,
      )
      .join("");
    return c ? `<g opacity="${O[b]}">${c}</g>` : "";
  };

  const insetX = 8;
  const insetY = m.height - i.height - 8;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${m.height}" width="${W}" height="${m.height}" role="img" aria-label="Taiwan drawn from 46,334 wildlife records">
<rect width="100%" height="100%" fill="none"/>
<g fill="#cf7238">${[0, 1, 2].map((b) => layer(m.points, b)).join("")}</g>
<g transform="translate(${insetX} ${insetY})">
<rect x="-4" y="-4" width="${IW + 8}" height="${i.height + 8}" fill="none" stroke="#9d9179" stroke-opacity="0.35" stroke-width="1"/>
<g fill="#cf7238">${[0, 1, 2].map((b) => layer(i.points, b, 0.85)).join("")}</g>
</g>
</svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control":
        "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
