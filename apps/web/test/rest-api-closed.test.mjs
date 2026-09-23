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
 * PostGIS objects, owned by `supabase_admin`. `postgres` is not a superuser on
 * a managed instance and cannot revoke a grant it did not make — the attempt
 * answers "no privileges could be revoked" — so these three stay readable by
 * the anon key until the project stops exposing `public` through PostgREST at
 * all, which is a dashboard setting rather than SQL.
 *
 * What they hold: ~8,500 coordinate-system definitions, and two catalogue
 * views naming which columns are geometries. No project data, no coordinate of
 * any animal. `spatial_ref_sys` is still writable, which is an availability
 * risk rather than a disclosure one — deleting SRID 4326 would break every
 * geography operation on the site.
 *
 * Listed by name so a FOURTH exception has to be added deliberately, by
 * somebody who has to write down why.
 */
const NOT_OURS = ["spatial_ref_sys", "geometry_columns", "geography_columns"];

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
      .filter((r) => !NOT_OURS.includes(r.table_name))
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
      .filter((r) => !r.rls && !NOT_OURS.includes(r.table_name))
      .map((r) => r.table_name);
    assert.deepEqual(off, [], "RLS is off, so one stray grant reopens it");
  });

  test("every exception is a PostGIS object we genuinely cannot touch", async () => {
    // If PostGIS is ever relocated to `extensions`, or the exposed schema is
    // changed, these stop existing in `public` and the exceptions should go
    // rather than quietly covering for a table somebody forgot to close.
    const rows = await sql`
      select c.relname as name, r.rolname as owner
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_roles r on r.oid = c.relowner
       where n.nspname = 'public'
         and c.relkind in ('r', 'v')
         and c.relname = any(${NOT_OURS})`;
    assert.deepEqual(
      rows.map((r) => r.name).sort(),
      [...NOT_OURS].sort(),
      "an exception is listed for something that is not there any more",
    );
    for (const r of rows)
      assert.notEqual(
        r.owner,
        "postgres",
        `${r.name} is ours after all — close it instead of excusing it`,
      );
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
    // The table with the true coordinates and the contact addresses. RLS on,
    // and every policy scoped to `authenticated` with an auth.uid() test.
    const [{ rls }] = await sql`
      select relrowsecurity as rls from pg_class
       where relname = 'reports' and relnamespace = 'public'::regnamespace`;
    assert.equal(rls, true);

    const policies = await sql`
      select policyname, roles::text as roles, qual
        from pg_policies where schemaname = 'public' and tablename = 'reports'`;
    assert.ok(policies.length > 0, "RLS with no policy at all would also break the site");
    for (const p of policies) {
      assert.match(p.roles, /authenticated/, `${p.policyname} is not scoped to a signed-in user`);
      assert.match(p.qual, /auth\.uid\(\)/, `${p.policyname} does not check who is asking`);
    }
  });
});
