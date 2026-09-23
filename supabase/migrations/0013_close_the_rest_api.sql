-- The PostgREST API is open, and this project does not use it.
--
-- Supabase publishes every table in `public` through PostgREST at
-- https://<ref>.supabase.co/rest/v1/, to the `anon` and `authenticated` roles,
-- and grants those roles ALL privileges on everything by default. The only
-- thing standing between the publishable anon key — which ships in the client
-- bundle, by design — and the data is row-level security.
--
-- On three tables there was none. Verified against production on 23 September
-- 2026 with the real anon key:
--
--     GET /rest/v1/taxa?select=id,scientific_name&limit=2   -> 200, real rows
--     GET /rest/v1/reports?select=id&limit=1                -> 200, []
--
-- `reports`, `report_photos` and `profiles` held: RLS on, policies scoped to
-- `authenticated` and `auth.uid()`. No true coordinate and no contact address
-- was reachable. `taxa`, `_migrations` and `spatial_ref_sys` were open, and
-- `anon` held DELETE and UPDATE on them as well as SELECT.
--
-- Reading `taxa` discloses nothing — it is TaiCOL's public checklist. Deleting
-- it is the problem: `reports.taxon_id` is `on delete set null` (0001:131), so
-- `DELETE FROM taxa` would strip the species from all 46,402 records, and 0011
-- would then blur every one of them. One unauthenticated request, and every
-- identification this project holds is gone.
--
-- THE FIX IS TO CLOSE THE API, NOT TO PATCH THE THREE TABLES.
--
-- Nothing here talks to PostgREST. Every table read and write goes through
-- `postgres.js` on a direct connection (lib/db.ts), as `postgres` for the
-- server's own work and as `web_anon` for anything a visitor can see. The
-- Supabase client is used for exactly two things, neither of which touches a
-- table: auth, and `.storage.from(PHOTO_BUCKET)`. There is not one `.from('<a
-- table>')` or `.rpc()` call in the codebase.
--
-- So the grants are revoked rather than the tables individually defended. A
-- table added next year is then closed on the day it is created, instead of
-- waiting for someone to notice the dashboard warning.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all privileges on all tables in schema public from anon;
    revoke all privileges on all sequences in schema public from anon;
    alter default privileges in schema public revoke all on tables from anon;
    alter default privileges in schema public revoke all on sequences from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all privileges on all tables in schema public from authenticated;
    revoke all privileges on all sequences in schema public from authenticated;
    alter default privileges in schema public revoke all on tables from authenticated;
    alter default privileges in schema public revoke all on sequences from authenticated;
  end if;
end $$;

-- FUNCTIONS ARE DELIBERATELY LEFT ALONE. PostGIS lives in `public` here — 439
-- `st_*` functions — and `web_anon` runs them on every public query. The RLS
-- policies on `profiles` call `is_moderator()` as `authenticated`, so revoking
-- execute there would break the policy that protects the table. Grants on
-- tables are the surface; function grants are load-bearing.

-- Second layer, on the two tables this project owns. Even with no grant left,
-- a table with RLS off is one `grant` away from being open again, and the
-- Supabase dashboard warns on exactly this.
alter table taxa enable row level security;

-- `_migrations` is created by the RUNNER (scripts/migrate.ts), not by any
-- migration, so on a database built by the psql loop — CI's, and production's
-- before it was baselined — it does not exist yet and `alter table` on it
-- aborts the whole file. CI caught exactly that.
--
-- Creating it here rather than guarding the alter: the ledger should exist and
-- be closed on every database that has ever run a migration, not on the subset
-- that happened to go through the runner first. Same shape the runner uses, so
-- whichever gets there first, the other is a no-op.
create table if not exists _migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

alter table _migrations enable row level security;

-- `taxa` is read by `web_anon` on every species page, directory page and map
-- popup (lib/species.ts), and `web_anon` does not bypass RLS. Without this
-- policy, enabling RLS above would 404 every species page on the site — which
-- is the kind of fix that gets reverted at 2am rather than understood.
drop policy if exists taxa_public_read on taxa;
create policy taxa_public_read on taxa for select to web_anon using (true);

-- `_migrations` gets no policy at all. It is the ledger this runner keeps, and
-- nothing but the owner has any business reading it.

-- THREE POSTGIS OBJECTS SURVIVE ALL OF THE ABOVE, and it is worth being exact
-- about why rather than leaving a dashboard warning to be rediscovered:
-- `spatial_ref_sys`, `geometry_columns` and `geography_columns` are owned by
-- `supabase_admin`. `postgres` is not a superuser here and cannot revoke a
-- grant it did not make — the attempt answers "no privileges could be revoked"
-- — nor alter a table it does not own.
--
-- They hold ~8,500 coordinate-system definitions and two catalogue views
-- naming which columns are geometries. No project data and no animal's
-- coordinate. `spatial_ref_sys` does stay writable, which is an availability
-- risk rather than a disclosure one: deleting SRID 4326 would break every
-- geography operation on the site.
--
-- The fix for those is not SQL. It is to stop the project exposing `public`
-- through PostgREST at all, which is one setting, and which is safe here
-- precisely because nothing uses the REST API. That is the owner's call, so it
-- is written down rather than done.
--
-- The attempt is made anyway, and its failure reported rather than aborting:
-- on an instance where `postgres` DOES own them, this closes them too.
do $$
declare t text;
begin
  foreach t in array array['spatial_ref_sys'] loop
    begin
      execute format('alter table public.%I enable row level security', t);
      raise notice '%: RLS enabled', t;
    exception when others then
      raise notice '%: not ours (%) — see the note above', t, sqlerrm;
    end;
  end loop;
end $$;
