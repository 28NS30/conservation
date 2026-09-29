-- Close the site's own functions to the REST API.
--
-- 0013 closed every table to `anon` and `authenticated`, the two roles the
-- publishable key reaches through https://<ref>.supabase.co/rest/v1/. It left
-- FUNCTIONS open: Postgres grants EXECUTE to PUBLIC on every new function, and
-- PostgREST publishes each one at /rest/v1/rpc/<name>. On 29 September 2026
-- production let `anon` execute 23 of this project's functions, among them
-- bump_rate_limit, tighten_reports, resolve_taxa_lineage and is_moderator.
--
-- None of them was exploitable that day, and why is worth writing down. All but
-- two run with the caller's rights, and the caller (anon) holds no privilege on
-- any table they touch, so each call ends in "permission denied". The two
-- SECURITY DEFINER ones are is_moderator(), which answers only about the
-- caller, and handle_new_user(), a trigger function that cannot be called
-- directly. But the safety rested on every future function staying that way:
-- one SECURITY DEFINER function written for a trigger or a job would have been
-- a public endpoint the day it was created, with nobody having decided so.
--
-- So EXECUTE is revoked from PUBLIC, anon and authenticated on every function
-- this project defines in `public` (PostGIS's own belong to the extension and
-- stay as they are), and the default privileges are changed so a function
-- created later starts closed too.
--
-- Nothing the site does needs these grants:
--   * the server's own connection owns the functions;
--   * web_anon, the role public reads drop to (lib/db.ts asPublic), calls none
--     of them directly, and no view it reads calls one (checked: no view in
--     `public` names any of them);
--   * trigger functions are not checked for EXECUTE when they fire, so the
--     blur triggers run exactly as before;
--   * the row-level-security policies that call is_moderator() sit on tables
--     the API roles cannot read at all (0013).
--
-- From here a new function is executable by its owner alone. One that web_anon
-- must call, because a view it reads calls it, is granted to web_anon by name,
-- as 0025 does for suggestions_within_blur.
--
-- Guarded by role existence: CI's plain Postgres has no anon or authenticated.
-- Safe to re-run.

do $$
declare
  f regprocedure;
  targets text := 'public';
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    targets := targets || ', anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    targets := targets || ', authenticated';
  end if;

  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       -- Not a member of an extension (PostGIS): those are the extension's.
       and not exists (
         select 1 from pg_depend d
          where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from %s', f, targets);
  end loop;

  -- Functions created from now on start closed, for the role that runs the
  -- migrations (`postgres`, in production and locally). Two defaults grant
  -- EXECUTE and both have to go: Supabase's per-schema one, naming anon and
  -- authenticated, and Postgres's own GLOBAL one to PUBLIC, which a per-schema
  -- REVOKE cannot touch (a per-schema default only adds to the global one).
  execute format(
    'alter default privileges in schema public revoke execute on functions from %s',
    targets);
  execute 'alter default privileges revoke execute on functions from public';
end $$;
