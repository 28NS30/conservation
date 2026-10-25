-- Supabase's three API roles, and the default grants every Supabase project
-- gives `anon` and `authenticated`, for CI's empty PostGIS cluster. FOR THAT
-- CLUSTER ONLY, BEFORE THE MIGRATIONS; NEVER ON A SUPABASE PROJECT. It
-- refuses to run anywhere else.
--
-- Without it CI never tested the privacy boundary the REST API reaches. The
-- publishable anon key ships in every browser, and on Supabase `anon` and
-- `authenticated` are handed ALL on every table, sequence and function
-- `postgres` creates in `public`. 0013 and 0024 revoke that, and the tests
-- that check they did (privacy, rest-api-closed, blurred-records-say-less,
-- forum-schema, forum-votes) skip when the roles are missing. On CI's plain
-- PostGIS cluster they always were, so the thirty tests of what anon and
-- authenticated can reach, exact points among it, had never run anywhere but
-- a laptop.
--
-- WHY IT REFUSES. The grants below are default privileges: they open every
-- table and function created after them. Before the migrations that is the
-- point, because 0013 and 0024 then take them back the way they did on
-- production. After the migrations nothing would take them back, and every
-- table created from then on, any that holds exact points among them, would
-- open to the anon key on the day it was made. So the block below raises,
-- and changes nothing, on any cluster that is a Supabase one (the local
-- stack, a scratch database inside it, a hosted project) or that the
-- migrations have already touched. CI's service container is new on every
-- run, so it never meets a second run; to try it again, start a new cluster
-- (docs/qa-harness.md says how).
--
-- WHAT IT GRANTS, and why no more. The defaults are the ones production was
-- created with, ALL on whatever `postgres` creates in `public`, for the two
-- roles the migrations revoke them from. That is how 0013 found `anon`
-- holding DELETE and UPDATE on `taxa`. They are stated for `postgres` by
-- name because the migrations run as it and a default applies only to
-- objects its own role creates, which is also the role 0013's and 0024's
-- revokes name. Once the migrations have run, ci-roles-check.sql looks for
-- what is left of them and fails CI on any of it, except the EXECUTE that
-- pg_trgm's functions keep (0005 makes the extension after these defaults,
-- and 0024 leaves an extension's functions alone): PUBLIC holds the same on
-- each, and a Supabase project grants it too.
--
--   * `service_role` is created as production has it (nologin, bypassrls),
--     so a migration that names it applies here, and is given nothing.
--     Production's ALL for it is left out because no migration revokes it
--     and no test reads it: here it would be a grant this file alone decided.
--   * USAGE on `public` is not granted. Every Postgres gives it to PUBLIC,
--     production's included, and that is how `anon` reaches the schema there
--     and here. ci-roles-check.sql makes sure it still does: without it
--     "anon is denied SELECT on reports" would be refused at the schema, and
--     pass whatever the table's own grants said.
--   * Statement timeouts and `authenticator` are left out: nothing logs in
--     as these roles, and SET ROLE ignores a role's settings.
--
-- The `auth` schema is not faked. The migrations guard what needs it on the
-- schema as well as the role (0004), so the policies that call auth.uid() stay
-- untested here, as before; the grants are what this file is for.
--
-- One statement, so a refusal leaves the cluster exactly as it found it.

do $$
declare
  found text[] := '{}';
  n bigint;
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    found := found || 'the role supabase_admin, so this is a Supabase cluster'::text;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    found := found || 'an auth schema'::text;
  end if;
  if exists (select 1 from pg_roles
              where rolname in ('anon', 'authenticated', 'service_role', 'web_anon')) then
    found := found || 'the API roles or web_anon already (roles belong to the whole cluster)'::text;
  end if;

  -- What the migrations leave in `public`: anything that is not a member of
  -- an extension. A fresh cluster has PostGIS's own objects there and
  -- nothing else.
  select count(*) into n
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_class'::regclass
                        and d.objid = c.oid and d.deptype = 'e');
  if n > 0 then
    found := found || format('%s tables, views or sequences in public', n);
  end if;
  select count(*) into n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass
                        and d.objid = p.oid and d.deptype = 'e');
  if n > 0 then
    found := found || format('%s functions in public', n);
  end if;

  if cardinality(found) > 0 then
    raise exception 'ci-roles.sql is for CI''s empty PostGIS cluster, before the migrations, and changed nothing. This database has %.',
      array_to_string(found, '; ')
      using hint = 'Its default privileges would reopen every table created after the migrations to the anon key. Start a new cluster.';
  end if;

  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  alter default privileges for role postgres in schema public
    grant all on tables to anon, authenticated;
  alter default privileges for role postgres in schema public
    grant all on sequences to anon, authenticated;
  alter default privileges for role postgres in schema public
    grant all on functions to anon, authenticated;
end $$;
