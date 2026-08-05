/**
 * The /stats aggregates.
 *
 * The hotspot list is the highest-risk thing on the page: it names the densest
 * few square kilometres in the country and the species that dominates each. Get
 * it wrong and it becomes a directory of where to find protected animals, which
 * is the exact failure the obscuring design exists to prevent. Most of what is
 * below is about that.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql, BASE_URL } from "./helpers.mjs";

after(() => sql.end());

before(async () => {
  const res = await fetch(BASE_URL).catch(() => null);
  if (!res) throw new Error(`dev server not reachable at ${BASE_URL} — run \`npm run dev\``);
});

const CELL = 5000;

/** The hotspot aggregation, run exactly as lib/stats.ts runs it. */
const hotspotRows = (limit = 8) => sql`
  with cells as (
    select floor(st_x(geom_3857) / ${CELL})::int as gx,
           floor(st_y(geom_3857) / ${CELL})::int as gy,
           taxon_id, count(*)::int as n
      from reports_public
     where not is_obscured
     group by 1, 2, 3
  ),
  totals as (
    select gx, gy, sum(n)::int as n from cells group by 1, 2 order by n desc limit ${limit}
  ),
  dominant as (
    select distinct on (c.gx, c.gy) c.gx, c.gy, c.taxon_id
      from cells c join totals t on t.gx = c.gx and t.gy = c.gy
     where c.taxon_id is not null
     order by c.gx, c.gy, c.n desc
  )
  select t.gx, t.gy, t.n, d.taxon_id
    from totals t left join dominant d on d.gx = t.gx and d.gy = t.gy
   order by t.n desc`;

describe("hotspots", () => {
  test("never surface a taxon whose coordinates are withheld", async () => {
    const rows = await sql`
      with h as (${hotspotRows(50)})
      select count(*)::int as leaked
        from h join taxa t on t.id = h.taxon_id
       where t.sensitivity = '座標不開放'`;
    assert.equal(rows[0].leaked, 0, "a suppressed taxon must never be named as a hotspot's species");
  });

  test("exclude obscured records entirely", async () => {
    // Obscured points are snapped to the centre of their privacy cell, so
    // including them would pile many reports onto one coordinate and invent a
    // hotspot that is an artefact of blurring — pointing straight at the cell
    // holding a sensitive species.
    // Obscured records may well fall inside a hot cell; what matters is that
    // they contribute nothing to its count.
    const [check] = await sql`
      with h as (${hotspotRows(8)})
      select coalesce(sum(h.n), 0)::int as claimed,
             (select count(*)::int from reports_public r
               where not r.is_obscured
                 and (floor(st_x(r.geom_3857) / ${CELL})::int, floor(st_y(r.geom_3857) / ${CELL})::int)
                     in (select gx, gy from h)) as actual
        from h`;
    assert.ok(check.claimed > 0, "expected at least one hotspot in the seeded data");
    assert.equal(
      check.claimed,
      check.actual,
      "cell totals must count exactly the unobscured records in those cells",
    );
  });

  test("cell totals are the sum of their per-species parts", async () => {
    const [row] = await sql`
      with h as (${hotspotRows(8)}),
      parts as (
        select floor(st_x(geom_3857) / ${CELL})::int as gx,
               floor(st_y(geom_3857) / ${CELL})::int as gy, count(*)::int as n
          from reports_public where not is_obscured group by 1, 2
      )
      select count(*)::int as mismatched
        from h join parts p on p.gx = h.gx and p.gy = h.gy
       where p.n <> h.n`;
    assert.equal(row.mismatched, 0);
  });

  test("are returned in descending order of density", async () => {
    const rows = await hotspotRows(8);
    const counts = rows.map((r) => r.n);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  });

  test("the dominant species is genuinely the most frequent in its cell", async () => {
    const rows = await hotspotRows(5);
    for (const r of rows) {
      if (r.taxon_id === null) continue;
      const [best] = await sql`
        select taxon_id, count(*)::int as n
          from reports_public
         where not is_obscured
           and taxon_id is not null
           and floor(st_x(geom_3857) / ${CELL})::int = ${r.gx}
           and floor(st_y(geom_3857) / ${CELL})::int = ${r.gy}
         group by 1 order by n desc, taxon_id limit 1`;
      const [claimed] = await sql`
        select count(*)::int as n from reports_public
         where not is_obscured and taxon_id = ${r.taxon_id}
           and floor(st_x(geom_3857) / ${CELL})::int = ${r.gx}
           and floor(st_y(geom_3857) / ${CELL})::int = ${r.gy}`;
      // Compare counts rather than ids: ties are broken arbitrarily by
      // `distinct on`, and either winner is correct.
      assert.equal(claimed.n, best.n, `cell ${r.gx},${r.gy} named a species that is not its most frequent`);
    }
  });
});

describe("overview totals", () => {
  test("reconcile with reports_public", async () => {
    const [row] = await sql`
      select count(*)::int                                     as reports,
             count(distinct taxon_id)::int                     as species,
             count(*) filter (where is_obscured)::int          as obscured,
             count(*) filter (where taxon_id is not null)::int as identified
        from reports_public`;
    assert.ok(row.reports > 0);
    assert.ok(row.identified <= row.reports);
    assert.ok(row.obscured <= row.reports);
    assert.ok(row.species <= row.identified);
  });

  test("monthly buckets sum to the total", async () => {
    const [row] = await sql`
      select (select sum(n) from (
                select count(*)::int as n from reports_public group by extract(month from observed_at)
              ) s)::int as bucketed,
             (select count(*) from reports_public)::int as total`;
    assert.equal(row.bucketed, row.total);
  });

  test("yearly buckets sum to the total", async () => {
    const [row] = await sql`
      select (select sum(n) from (
                select count(*)::int as n from reports_public group by extract(year from observed_at)
              ) s)::int as bucketed,
             (select count(*) from reports_public)::int as total`;
    assert.equal(row.bucketed, row.total);
  });
});

describe("the page itself", () => {
  test("renders in both locales", async () => {
    for (const path of ["/stats", "/en/stats"]) {
      const res = await fetch(`${BASE_URL}${path}`);
      assert.equal(res.status, 200, `${path} should render`);
      const body = await res.text();
      // next-intl renders the raw key path when a message is missing.
      assert.ok(!body.includes("statsPage."), `${path} has an unresolved message key`);
    }
  });

  test("map deep-link query is validated, not trusted", async () => {
    // A NaN or out-of-range coordinate reaching MapLibre's jumpTo() throws and
    // takes the whole map down, so the server must reject it and fall back.
    for (const q of ["?lat=999&lng=abc", "?lat=1e999&lng=0", "?lng=<script>&lat=0"]) {
      const res = await fetch(`${BASE_URL}/${q}`);
      assert.equal(res.status, 200, `${q} should still render the map`);
      const body = await res.text();
      assert.ok(!body.includes("<script>alert"), "query string must not reach the page unescaped");
    }
  });
});
