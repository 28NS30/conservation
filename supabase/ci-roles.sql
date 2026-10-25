-- Supabase's three API roles, and the grants every Supabase project starts
-- with, for a plain PostGIS cluster. CI runs this before the migrations.
--
-- Without it CI never tested the privacy boundary the REST API reaches. The
-- publishable anon key ships in every browser, and on Supabase `anon`,
-- `authenticated` and `service_role` are handed ALL on every table, sequence
-- and function `postgres` creates in `public`. 0013 and 0024 revoke that, and
-- the tests that check they did (privacy, blurred-records-say-less,
-- forum-schema, forum-votes) skip when the roles are missing. On CI's plain
-- PostGIS cluster they always were, so about thirty tests about who can read
-- an exact coordinate had never run anywhere but a laptop.
--
-- The default privileges are the ones production was created with: ALL to
-- all three, on whatever `postgres` creates in `public`. That is how 0013
-- found `anon` holding DELETE and UPDATE on `taxa`. A project made by a recent
-- Supabase CLI no longer starts that open (auto_expose_new_tables in
-- supabase/config.toml), so the local stack is not the reference; production
-- is. They are stated for `postgres` by name because the migrations run as it,
-- and a default applies only to objects its own role creates. Statement
-- timeouts and `authenticator` are left out: nothing logs in as these roles,
-- and SET ROLE ignores a role's settings.
--
-- The `auth` schema is not faked. The migrations guard what needs it on the
-- schema as well as the role (0004), so the policies that call auth.uid() stay
-- untested here, as before; the grants are what this file is for.
--
-- Safe to re-run.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
