/**
 * Location-privacy invariants.
 *
 * These are the highest-consequence rules in the project: if they break, the site
 * publishes precise coordinates of protected species, which is a poaching aid.
 * They are enforced in SQL (0001_init.sql, 0003_reporting.sql) rather than app
 * code, and this file is the regression guard for that enforcement.
 *
 *   node --test test/
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql, inRollback, taxonWhere, insertReport } from "./helpers.mjs";

after(() => sql.end());

describe("obscuring is deterministic", () => {
  test("the same report id always yields the same published point", async () => {
    const [row] = await sql`
      select count(distinct pt) as n from (
        select st_astext(obscure_point(
          st_point(120.6839, 24.1477, 4326)::geography,
          '11111111-1111-1111-1111-111111111111'::uuid, 0.1)::geometry, 9) as pt
        from generate_series(1, 50)
      ) s`;
    // Re-randomising per read would let anyone average repeated requests back to
    // the true coordinate.
    assert.equal(Number(row.n), 1, "obscure_point must be deterministic per report");
  });

  test("different reports of the same point land differently", async () => {
    const [row] = await sql`
      select count(distinct pt) as n from (
        select st_astext(obscure_point(
          st_point(120.6839, 24.1477, 4326)::geography, gen_random_uuid(), 0.1)::geometry, 9) as pt
        from generate_series(1, 20)
      ) s`;
    assert.ok(Number(row.n) > 15, `expected varied offsets, got ${row.n} distinct`);
  });
});

describe("obscuring discloses the cell and nothing finer", () => {
  test("published point stays inside the true point's grid cell", async () => {
    const [row] = await sql`
      select count(*) filter (where not same) as violations, count(*) as checked from (
        select floor(st_x(p::geometry)/0.1) = floor(st_x(obscure_point(p, id, 0.1)::geometry)/0.1)
           and floor(st_y(p::geometry)/0.1) = floor(st_y(obscure_point(p, id, 0.1)::geometry)/0.1) as same
        from (
          select st_point(119.5 + random()*2.5, 21.9 + random()*3.5, 4326)::geography as p,
                 gen_random_uuid() as id
          from generate_series(1, 2000)
        ) pts
      ) s`;
    assert.equal(Number(row.violations), 0, `${row.violations}/${row.checked} points escaped their cell`);
  });
});

describe("taxon sensitivity drives precision", () => {
  test("a non-sensitive taxon publishes at exact precision", async () => {
    await inRollback(async (tx) => {
      const id = await taxonWhere("scientific_name = 'Paguma larvata'");
      const r = await insertReport(tx, { taxonId: id });
      assert.equal(r.location_precision, "exact");
      assert.equal(Number(r.offset_m), 0);
    });
  });

  test("a protected taxon is blurred", async () => {
    await inRollback(async (tx) => {
      const id = await taxonWhere("scientific_name = 'Prionailurus bengalensis'");
      const r = await insertReport(tx, { taxonId: id });
      assert.equal(r.location_precision, "coarse_10km");
      assert.ok(Number(r.offset_m) > 500, `expected a real offset, got ${r.offset_m}m`);
    });
  });

  test("a 座標不開放 taxon is suppressed and never appears publicly", async () => {
    await inRollback(async (tx) => {
      const id = await taxonWhere("sensitivity = '座標不開放'");
      const r = await insertReport(tx, { taxonId: id });
      assert.equal(r.location_precision, "suppressed");
      const [seen] = await tx`select count(*) as n from reports_public where id = ${r.id}`;
      assert.equal(Number(seen.n), 0, "suppressed reports must be absent from reports_public");
    });
  });
});

describe("precision_override can only tighten", () => {
  test("it makes a non-sensitive report coarser", async () => {
    await inRollback(async (tx) => {
      const id = await taxonWhere("scientific_name = 'Paguma larvata'");
      const r = await insertReport(tx, { taxonId: id, override: "coarse_50km" });
      assert.equal(r.location_precision, "coarse_50km");
    });
  });

  test("it CANNOT loosen a suppressed taxon", async () => {
    await inRollback(async (tx) => {
      const id = await taxonWhere("sensitivity = '座標不開放'");
      const r = await insertReport(tx, { taxonId: id, override: "exact" });
      assert.equal(r.location_precision, "suppressed",
        "an override must never reveal what the taxon's own rating hides");
    });
  });

  test("it CANNOT loosen a protected taxon", async () => {
    await inRollback(async (tx) => {
      const id = await taxonWhere("scientific_name = 'Prionailurus bengalensis'");
      const r = await insertReport(tx, { taxonId: id, override: "exact" });
      assert.notEqual(r.location_precision, "exact");
    });
  });
});

describe("the public role cannot reach true coordinates", () => {
  // This grant is the entire privacy boundary. It should not be possible to
  // regress it silently.
  for (const role of ["web_anon", "anon"]) {
    test(`${role} is denied SELECT on reports`, async (t) => {
      // `anon` is a Supabase role and is absent on the plain PostGIS cluster CI
      // uses. Skip explicitly rather than letting "role does not exist" pass as
      // if the boundary had been verified.
      const [{ exists }] = await sql`
        select exists (select 1 from pg_roles where rolname = ${role}) as exists`;
      if (!exists) return t.skip(`role ${role} not present on this cluster`);

      await assert.rejects(
        () => sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select location from reports limit 1`;
        }),
        (err) => /permission denied/i.test(err.message),
        `${role} must not be able to read the reports base table`,
      );
    });
  }

  test("web_anon CAN read the published view", async () => {
    const n = await sql.begin(async (tx) => {
      await tx`set local role web_anon`;
      const [row] = await tx`select count(*) as n from reports_public`;
      return Number(row.n);
    });
    assert.ok(n > 0, "reports_public should be readable and non-empty");
  });

  test("GPS accuracy is published only beside an exact coordinate", async () => {
    // The obscuring stack moves a sensitive species' point by up to 50 km.
    // Publishing "±12 m" beside that point would not give the location away,
    // but it would publish a statement about the location that the blur exists
    // to avoid making — that the true coordinate was measured to within twelve
    // metres. So the column reads null wherever the point is not exact.
    await inRollback(async (tx) => {
      const sensitive = await taxonWhere("sensitivity = '輕度'");
      const open = await taxonWhere(
        "sensitivity is null and protected_status is null",
      );

      for (const [taxonId, precision, expected] of [
        [open, "exact", 12],
        [sensitive, "coarse_10km", null],
      ]) {
        const [row] = await tx`
          insert into reports (category, location, location_public, observed_at,
                               taxon_id, taxon_source, status, source,
                               location_accuracy_m)
          values ('sighting',
                  st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
                  st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
                  now(), ${taxonId}, 'user', 'published', 'user', 12)
          returning id, location_precision`;
        assert.equal(row.location_precision, precision, "fixture assumption");

        const [pub] = await tx`
          select location_accuracy_m from reports_public where id = ${row.id}`;
        assert.equal(
          pub.location_accuracy_m,
          expected,
          `accuracy beside a ${precision} point`,
        );
      }
    });
  });

  test("reports_public does not expose the true location column", async () => {
    const cols = await sql`
      select column_name from information_schema.columns
       where table_name = 'reports_public'`;
    const names = cols.map((c) => c.column_name);
    assert.ok(!names.includes("location"), "reports_public must not carry `location`");
    assert.ok(!names.includes("contact_email"), "reports_public must not carry reporter emails");
    assert.ok(names.includes("location_public"));
  });
});
