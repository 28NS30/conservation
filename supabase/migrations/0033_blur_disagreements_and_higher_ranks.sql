-- Two blur loopholes closed: a name above the species, and a reporter's name
-- the model has not checked yet.
--
-- 1. A RECORD NAMED ABOVE THE SPECIES IS BLURRED AT LEAST 10 KM.
--
-- TaiCOL rates sensitivity on species rows, and the protected-species list
-- names species, so a genus, a family or an order carries no rating of its
-- own. taxon_precision() climbs from a subspecies to its species and stops
-- there (0014): it never looks down, and was never meant to. So a record
-- filed under a name above the species read "unrated" and was published to
-- the metre, whatever that name holds. On production on 25 October 2026,
-- 246 genera recorded in Taiwan held a protected species and computed
-- 'exact': Prionailurus, which holds 石虎, among them. A record named only
-- "a Prionailurus" is very likely a 石虎.
--
-- Nobody can file one that way today. The picker offers species and
-- subspecies only (OFFERED, apps/web/lib/species.ts), POST /api/reports files
-- any other name as unidentified, and a moderator's naming now takes only
-- an OFFERED name or one of the model's own candidates for the record. On
-- the same day no record on production was on such a name, nor on a row
-- sharing a binomial with one, so this changes no published blur. But a GBIF
-- import identified to the genus or a model's label list could put one
-- there, and the rule should not depend on all of them staying shut.
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
-- tighten_reports() and tighten_binomial_siblings(), which never loosen.
--
-- 2. A NAMED REPORT WITH A PHOTO IS HELD AT 10 KM UNTIL THE MODEL HAS LOOKED.
--
-- A reporter who names the species is published at once, at that species'
-- blur, and the model's opinion was only ever recorded beside theirs. A dead
-- 石虎 filed as 家貓 was therefore public to the metre, with its notes, on the
-- reporter's word. The classifier now blurs such a record as the model's
-- species would be when the model is sure of another
-- (apps/web/lib/report/classificationHold.ts), but it runs after the record
-- is public, and a run that fails waits for the next day's cron or never
-- comes. So POST /api/reports sets `held_for_classification` on a named
-- report with a photo, and the trigger below blurs a held record at least
-- 10 km, the unidentified blur, until the classifier has run on it and
-- released the hold. If the model never answers, the hold stays.
--
-- Releasing the hold is not a loosening of the blur policy. The owner decided
-- where a named record ends (30 September 2026: an invasive species at its
-- exact spot, a protected one at its rating's blur), and the hold is a short
-- technical state on the way there, while the one check that could
-- contradict the reporter has not run. It is its own column so that it can
-- never be read as, or cleared with, anything that IS a decision: a
-- moderator's or the model's precision_override, the unidentified stamp, a
-- floor. The classifier is the only thing that releases it.
--
-- No existing record is held (the column starts false), so this part moves
-- no blur either. The check at the end refuses the migration if any record
-- would loosen.
--
-- Apply this before the app that writes the column is deployed: until it is,
-- POST /api/reports cannot insert a named report with a photo.
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

-- The hold. Only when the column is missing: ALTER TABLE takes ACCESS
-- EXCLUSIVE on `reports` even when it changes nothing, and every page reads
-- it, so re-running this file would stop the site for as long as it waited.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'reports'
                    and column_name = 'held_for_classification') then
    alter table public.reports
      add column held_for_classification boolean not null default false;
    comment on column public.reports.held_for_classification is
      'A named report with a photo, published and blurred at least 10 km until the classifier has run on it. Set by POST /api/reports, released only by the classifier (apps/web/lib/report/classificationHold.ts). Not a precision_override: nothing that reads or clears overrides touches it.';
  end if;
end $$;

-- 0014's trigger function, with the hold as one more term. report_precision()
-- still decides everything else, so tighten_reports()' question ("are the
-- rules now stricter than this record?") is the one the trigger answers; the
-- hold can only make the trigger's answer stricter than that, never looser.
create or replace function public.set_report_public_location() returns trigger
language plpgsql set search_path = public as $$
declare
  p text;
begin
  p := stricter_precision(report_precision(new.taxon_id, new.precision_override),
                          case when new.held_for_classification then 'coarse_10km' end);

  new.location_precision := p;
  new.location_public := case
    when p = 'exact' then new.location
    else obscure_point(new.location, new.id, precision_cell_deg(p))
  end;
  return new;
end $$;

-- And it fires when the hold is released, so the record is re-blurred to its
-- decided precision in the same statement. Replaced in place (0014 explains
-- why not drop-then-create), and only when it does not fire on the hold yet:
-- the replacement takes SHARE ROW EXCLUSIVE on `reports`.
do $$
begin
  if not exists (select 1 from pg_trigger t
                   join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'reports'
                    and t.tgname = 'reports_set_public_location'
                    and pg_get_triggerdef(t.oid) like '%held_for_classification%') then
    create or replace trigger reports_set_public_location
      before insert or update of location, taxon_id, precision_override, held_for_classification
      on public.reports
      for each row execute function public.set_report_public_location();
  end if;
end $$;

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
