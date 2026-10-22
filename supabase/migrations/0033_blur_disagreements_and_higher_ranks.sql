-- A record named above the species is blurred at least 10 km.
--
-- TaiCOL rates sensitivity on species rows, and the protected-species list
-- names species, so a genus, a family or an order carries no rating of its
-- own. taxon_precision() climbs from a subspecies to its species and stops
-- there (0014): it never looks down, and was never meant to. So a record
-- filed under a name above the species read "unrated" and was published to
-- the metre, whatever that name holds. On the local copy of production 246
-- genera recorded in Taiwan hold a protected species and computed 'exact':
-- Prionailurus, which holds 石虎, among them. A record named only "a
-- Prionailurus" is very likely a 石虎.
--
-- Nobody can file one that way today. The picker offers species and
-- subspecies only (OFFERED, apps/web/lib/species.ts), POST /api/reports files
-- any other name as unidentified, and setReportTaxon now refuses one too. On
-- production on 22 October 2026 no record was on such a name. But a GBIF
-- import identified to the genus, a moderator's correction or a model's
-- label list could put one there, and the rule should not depend on all of
-- them staying shut.
--
-- So a name whose rank is above the species — anything but 'Species', an
-- infraspecific rank (is_infraspecific, 0014) or 'Hybrid Formula' — takes at
-- least 'coarse_10km', the blur 0011 gives a record nobody has identified.
-- That is what such a record is: an animal named only as far as a group that
-- may hold a protected one. A rank TaiCOL leaves empty counts as above the
-- species, so a gap in the data blurs rather than publishes. A hybrid is
-- neither: it is a cross between named species, and 0014 already gives it no
-- parent to inherit from.
--
-- It is a term in taxon_precision(), so every rule that asks it agrees: the
-- record trigger, tighten_reports(), binomial_precision() and through it the
-- model's suggestions, and the species page's blur notice. It can only
-- tighten. The records already published are brought up to it through
-- tighten_reports() and tighten_binomial_siblings(), which never loosen, and
-- the check at the end refuses the migration if any record would.
--
-- This file is the database half of closing two blur loopholes; the other is
-- in the classifier (apps/web/lib/report/precision.ts, disagreementOverride):
-- a record whose reporter names one species while the model, confident,
-- names a stricter one is blurred as the model's species would be.
--
-- Safe to re-run.

set local lock_timeout = '5s';

-- Every record's blur before the rule changes, for the check at the end.
-- Session temp tables, dropped at the end: `on commit drop` vanishes at once
-- where each statement is its own transaction, as when CI applies migrations
-- file by file.
drop table if exists pg_temp.precision_before;
create temp table precision_before as
  select r.id, r.location_precision from reports r;

/**
 * Whether a rank sits above the species: not a species, not a part of one,
 * not a hybrid of two. Null counts as above, so an unknown rank blurs.
 */
create or replace function public.is_above_species(rank text) returns boolean
language sql immutable as $$
  select not coalesce(rank in ('Species', 'Hybrid Formula')
                      or public.is_infraspecific(rank), false)
$$;

-- Not a public endpoint (0024).
revoke execute on function public.is_above_species(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.is_above_species(text) from anon, authenticated;
  end if;
end $$;

-- 0029's taxon_precision(), with the rank term added before the climb. The
-- climb itself is unchanged: it only ever leaves an infraspecific row, so a
-- row above the species is read once, by itself.
create or replace function public.taxon_precision(p_taxon_id bigint)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  cur   record;
  p     text;
  depth int := 0;
begin
  select t.taicol_id, t.parent_taicol_id, t.rank, t.sensitivity, t.protected_status
    into cur
    from taxa t
   where t.id = p_taxon_id;
  if not found then
    return null;
  end if;

  if is_above_species(cur.rank) then
    p := 'coarse_10km';
  end if;

  loop
    p := stricter_precision(p, precision_from_taxon(cur.sensitivity, cur.protected_status));
    p := stricter_precision(p, (select f.min_precision
                                  from taxon_precision_floors f
                                 where f.taicol_id = cur.taicol_id));

    exit when not coalesce(is_infraspecific(cur.rank), false)
           or cur.parent_taicol_id is null
           or depth >= 6;

    select t.taicol_id, t.parent_taicol_id, t.rank, t.sensitivity, t.protected_status
      into cur
      from taxa t
     where t.taicol_id = cur.parent_taicol_id;
    exit when not found;
    depth := depth + 1;
  end loop;

  return p;
end
$$;

-- The records already named above the species, re-blurred, tightening only.
select tighten_reports(array(
  select distinct r.taxon_id
    from reports r
    join taxa t on t.id = r.taxon_id
   where is_above_species(t.rank)));

-- And any record named from a photograph under a row sharing a binomial with
-- one. No species row does today (the binomial of a genus is its one word),
-- so this is expected to change nothing; it is here so that the binomial rule
-- and the rank rule cannot disagree about a record.
select tighten_binomial_siblings(array(
  select t.id from taxa t where is_above_species(t.rank)));

do $$
declare
  loosened bigint;
begin
  select count(*) into loosened
    from reports r
    join precision_before b on b.id = r.id
   where precision_rank(r.location_precision) < precision_rank(b.location_precision);
  if loosened > 0 then
    raise exception '0033 would loosen % record(s)', loosened;
  end if;
end $$;

drop table pg_temp.precision_before;
