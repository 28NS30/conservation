/**
 * The PostgREST API must expose nothing.
 *
 * Supabase publishes every table in `public` at
 * https://<ref>.supabase.co/rest/v1/ to the `anon` and `authenticated` roles,
 * and grants those roles ALL privileges by default. The anon key ships in the
 * client bundle — that is what it is for — so the only thing between the open
 * internet and a table is row-level security.
 *
 * On 23 September 2026 three tables had none, and `anon` held DELETE on them.
 * `taxa` was the one that mattered: `reports.taxon_id` is `on delete set
 * null`, so one unauthenticated DELETE would have stripped the species from
 * all 46,402 records and left 0011 to blur every one of them.
 *
 * Nothing in this project talks to PostgREST. Every table read and write goes
 * through `postgres.js` on a direct connection; the Supabase client is used
 * only for auth and `.storage`. So the posture is not "each table is
 * defended", it is "the API is closed", and that is what these assert.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./helpers.mjs";

after(() => sql.end());

/**
 * PostGIS's own objects: ~8,500 coordinate-system definitions and two
 * catalogue views naming which columns are geometries. No project data, no
 * coordinate of any animal.
 *
 * On a managed instance `supabase_admin` owns them, `postgres` is not a
 * superuser, and a grant it did not make cannot be revoked — so they stay
 * readable by the anon key until the project stops exposing `public` through
 * PostgREST, which is a setting rather than SQL.
 *
 * Listed by name so a FOURTH exception has to be added deliberately, by
 * somebody who has to write down why.
 */
const POSTGIS = ["spatial_ref_sys", "geometry_columns", "geography_columns"];

describe("the REST API is closed", () => {
  test("no table grants anything to anon or authenticated", async () => {
    const rows = await sql`
      select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
        from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee in ('anon', 'authenticated')
       group by 1, 2
       order by 1, 2`;
    const offenders = rows
      .filter((r) => !POSTGIS.includes(r.table_name))
      .map((r) => `${r.table_name}: ${r.grantee} has ${r.privs}`);
    assert.deepEqual(
      offenders,
      [],
      "a table is reachable through /rest/v1 with the publishable anon key",
    );
  });

  test("every table we own has row-level security on", async () => {
    const rows = await sql`
      select c.relname as table_name, c.relrowsecurity as rls
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by 1`;
    const off = rows
      .filter((r) => !r.rls && !POSTGIS.includes(r.table_name))
      .map((r) => r.table_name);
    assert.deepEqual(off, [], "RLS is off, so one stray grant reopens it");
  });

  test("and RLS is never enabled on them, wherever they are owned", async () => {
    // An earlier version of this migration tried, reasoning that where
    // `postgres` DOES own them the attempt would close them too. It does own
    // them on a plain postgis image, the attempt succeeds, and PostGIS can then
    // no longer read `spatial_ref_sys` as any role without a policy — which is
    // every role that touches a coordinate. CI went red on /stats rendering no
    // figures, and it was slow to see because on a Supabase-shaped database
    // the alter fails and the damage never appears.
    //
    // So this asserts the absence, in both kinds of database. A migration that
    // behaves differently depending on who owns an extension table is one that
    // is only tested where it does nothing.
    const rows = await sql`
      select c.relname as name, c.relrowsecurity as rls
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and c.relname = any(${POSTGIS})`;
    for (const r of rows)
      assert.equal(
        r.rls,
        false,
        `${r.name} has RLS on — PostGIS reads it for every coordinate operation`,
      );
  });

  test("web_anon can still read spatial_ref_sys, which is the point", async () => {
    // The direct check, rather than trusting the flag. `set local role` inside
    // a transaction so nothing leaks into the pool.
    const [row] = await sql.begin(async (tx) => {
      await tx`set local role web_anon`;
      return tx`select count(*)::int as n from spatial_ref_sys where srid = 4326`;
    });
    assert.equal(row.n, 1, "web_anon cannot resolve SRID 4326");
  });
});

describe("what web_anon may still read", () => {
  test("taxa has the read policy the public pages depend on", async () => {
    // Without it, RLS on `taxa` 404s every species detail page — and the
    // directory renders EMPTY with a 200, which is the worse half: the site
    // looks fine and holds nothing. Verified by dropping the policy.
    const [p] = await sql`
      select roles::text as roles, cmd, qual
        from pg_policies
       where schemaname = 'public' and tablename = 'taxa'
         and policyname = 'taxa_public_read'`;
    assert.ok(p, "the species pages read taxa as web_anon and it does not bypass RLS");
    assert.equal(p.cmd, "SELECT");
    assert.match(p.roles, /web_anon/);
  });

  test("and nothing else — no policy opens a table to anon", async () => {
    const rows = await sql`
      select tablename, policyname, roles::text as roles
        from pg_policies where schemaname = 'public'`;
    const open = rows
      .filter((r) => /(\{|,)\s*(anon|public)\s*(,|\})/.test(r.roles))
      .map((r) => `${r.tablename}.${r.policyname} -> ${r.roles}`);
    assert.deepEqual(open, [], "a policy hands a table back to the anon key");
  });

  test("reports keeps its own boundary", async () => {
    // The table with the true coordinates and the contact addresses.
    const [{ rls }] = await sql`
      select relrowsecurity as rls from pg_class
       where relname = 'reports' and relnamespace = 'public'::regnamespace`;
    assert.equal(rls, true);

    // NOT "there is at least one policy". CI's database is a plain postgis
    // image with no `auth` schema, so 0004's Supabase policies are skipped and
    // `reports` ends up with RLS on and nothing else — which is stricter, not
    // looser, and asserting their presence failed a database that was safer
    // than the one the assertion was written against.
    //
    // The invariant that holds everywhere: whatever policies exist, none of
    // them hands the table to a signed-out caller.
    const policies = await sql`
      select policyname, roles::text as roles, coalesce(qual, '') as qual
        from pg_policies where schemaname = 'public' and tablename = 'reports'`;
    for (const p of policies) {
      assert.match(p.roles, /authenticated/, `${p.policyname} is not scoped to a signed-in user`);
      assert.match(p.qual, /auth\.uid\(\)/, `${p.policyname} does not check who is asking`);
    }
  });
});
