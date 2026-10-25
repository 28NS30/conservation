-- What ci-roles.sql gave the API roles, looked for after the migrations.
-- CI runs it once every migration has applied. It only reads the catalogue,
-- and raises if it finds anything.
--
-- ci-roles.sql opens everything `postgres` creates in `public` to `anon` and
-- `authenticated`, as production was opened, and 0013 and 0024 are what close
-- it again. If either stopped doing so, or a later migration gave one of the
-- three roles a default, a table, a column or a function, it is still here.
-- A default left behind would open every table made after it to the anon key,
-- on production as much as here.
--
-- One kind of grant stays, and is not counted: an extension's own object
-- keeps what it was made with, as 0024 leaves it. 0005 creates pg_trgm after
-- the defaults, so its functions are executable by `anon` and
-- `authenticated` here, as they are on a Supabase project, where pg_trgm's
-- and PostGIS's functions name all three roles. PUBLIC can execute each of
-- them too, so the grant reaches nothing everyone else cannot. An extension's
-- grant to an API role that PUBLIC does not also hold is counted.
--
-- USAGE on the schema is not a grant to these roles (every Postgres gives it
-- to PUBLIC), and it is checked the other way: it must still reach them, or
-- the tests' "permission denied" would be the schema's and not the table's.
--
-- Not for a Supabase project: Supabase's own defaults, for supabase_admin
-- and in its other schemas, name these roles by design.

do $$
declare
  held text;
begin
  with api as (
    select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')
  ), object_grants as (
    select format('%s on %s', a.privilege_type, c.oid::regclass) as what,
           a.grantee, a.privilege_type, c.relacl as acl, 'pg_class'::regclass as classid, c.oid as objid
      from pg_class c, aclexplode(c.relacl) a
     where c.relnamespace = 'public'::regnamespace
    union all
    select format('%s on %s.%s', a.privilege_type, c.oid::regclass, att.attname),
           a.grantee, a.privilege_type, att.attacl, 'pg_class'::regclass, c.oid
      from pg_attribute att
      join pg_class c on c.oid = att.attrelid, aclexplode(att.attacl) a
     where c.relnamespace = 'public'::regnamespace
    union all
    select format('%s on %s', a.privilege_type, p.oid::regprocedure),
           a.grantee, a.privilege_type, p.proacl, 'pg_proc'::regclass, p.oid
      from pg_proc p, aclexplode(p.proacl) a
     where p.pronamespace = 'public'::regnamespace
  ), counted as (
    select format('a default %s on new %s', a.privilege_type,
                  case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences'
                                       when 'f' then 'functions' when 'T' then 'types'
                                       else 'schemas' end) as what,
           a.grantee
      from pg_default_acl d, aclexplode(d.defaclacl) a
    union all
    select g.what, g.grantee
      from object_grants g
     where not (exists (select 1 from pg_depend d
                         where d.classid = g.classid and d.objid = g.objid and d.deptype = 'e')
                and exists (select 1 from aclexplode(g.acl) pub
                             where pub.grantee = 0 and pub.privilege_type = g.privilege_type))
  )
  select string_agg(format('%s: %s', c.grantee::regrole, c.what), E'\n  '
                    order by c.grantee::regrole::text, c.what)
    into held
    from counted c
   where c.grantee in (select oid from api);

  if held is not null then
    raise exception E'the API roles still hold, after every migration:\n  %', held;
  end if;

  if not (has_schema_privilege('anon', 'public', 'usage')
          and has_schema_privilege('authenticated', 'public', 'usage')) then
    raise exception 'anon and authenticated cannot reach schema public, so every denial the tests see would be the schema''s, not the table''s';
  end if;
end $$;
