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
-- 3. A HELD RECORD IS LEFT OFF THE MAP UNTIL IT IS RELEASED.
--
-- The hold is 10 km even for a species whose own rule is 50 km or hidden, so
-- a 石虎 filed as 家貓 sits in a 10 km cell until the model's answer blurs it
-- to 50 km. Map tiles are the worst place for that cell to be: Vercel's CDN
-- keeps a coarse-zoom tile up to about 25 hours (s-maxage 3600 plus
-- stale-while-revalidate 86400) and the app has no way to purge it, so the
-- cell could outlive the model's tightening by a day. So the tile route reads
-- `reports_on_map` below, which is reports_public without the held records,
-- in every layer: points, cells and dots. A record reaches the map once its
-- blur is decided. The view has reports_public's columns and no others; all
-- web_anon can learn from it that it could not before is which records are
-- held.
--
-- What is left is on the pages, by decision: while a record is held, its own
-- page, the lists and the statistics show it in the hold's 10 km cell. The
-- hold lasts minutes when the classifier runs straight after the report is
-- filed (POST /api/reports, in after()), until the next daily cron when that
-- run fails, and for good when the model never answers, in which case the
-- classifier flags the record for a moderator, who can queue it again
-- (apps/web/lib/report/classificationHold.ts). A page then keeps what it
-- showed for as long as it is cached, since nothing yet drops a cached page
-- when the hold is released: the record page not at all, as it is read on
-- every request; the list, collection and statistics pages for their minutes
-- of revalidation; a species page, which is static and lists the points of a
-- species with five records or fewer, until the next deploy.
--
-- 4. A TIGHTENING WHILE A RECORD IS HELD OUTLIVES THE HOLD.
--
-- tighten_binomial_siblings() (0028) writes the binomial's strictest blur as
-- an override where that is stricter than the record's blur now. While a
-- record is held, its blur now is the hold's 10 km, so a floor or a rating of
-- exactly 10 km given to a row sharing its binomial during the hold wrote
-- nothing, and the release then put the record at its own taxon's rule for
-- good, while a twin that was never held kept 10 km. It is replaced below to
-- compare with the blur the record will be released to, never the hold's.
-- tighten_reports() (0014) needs nothing: it stamps no override, and the
-- release re-derives the blur from the rules as they are then, a 10 km rule
-- added during the hold included. No other function decides from
-- location_precision whether to stamp one (0014, 0021, 0023, 0026, 0028, 0029
-- and 0032 checked; 0022's one-time remap stamped GBIF imports, which are
-- never held).
--
-- No existing record is held (the column starts false), so this part moves
-- no blur either. The check at the end refuses the migration if any record
-- would loosen.
--
-- Apply this before the app that writes the column is deployed: until it is,
-- POST /api/reports cannot insert a named report with a photo, and the map's
-- tiles, which read reports_on_map, fail.
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

-- 0028's tighten_binomial_siblings(), deciding from the blur a held record
-- will be released to (4 above). For a record held at the hold's own 10 km
-- that is its rule today, report_precision(), which is what the release
-- re-derives; for one held harder, by a rating since withdrawn, it is the
-- blur it has, which the release keeps (settleClassificationHold). Either
-- way the write is only ever stricter than the record: the trigger then takes
-- the stricter of the new override's rule and the hold, so a held record
-- never comes out of it looser than it went in. A record that is not held is
-- compared with its blur now, as before.
create or replace function public.tighten_binomial_siblings(p_taxon_ids bigint[])
returns bigint
language plpgsql
set search_path = public
as $$
declare
  siblings bigint[];
  n bigint;
begin
  select coalesce(array_agg(distinct s.id), '{}')
    into siblings
    from taxa t
    join taxa s
      on binomial_of(s.scientific_name) = binomial_of(t.scientific_name)
     and (s.kingdom is null or t.kingdom is null or s.kingdom = t.kingdom)
   where t.id = any (p_taxon_ids);

  if cardinality(siblings) = 0 then
    return 0;
  end if;

  update reports r
     set precision_override = stricter_precision(r.precision_override,
                                                 binomial_precision(r.taxon_id))
   where r.taxon_id = any (siblings)
     and r.taxon_source in ('ai', 'user', 'expert')
     and precision_rank(binomial_precision(r.taxon_id))
         > precision_rank(case
             when r.held_for_classification
              and precision_rank(r.location_precision) <= precision_rank('coarse_10km')
             then report_precision(r.taxon_id, r.precision_override)
             else r.location_precision
           end);
  get diagnostics n = row_count;
  return n;
end
$$;

-- The map's records (3 above): reports_public without the held ones. Over
-- reports_public rather than beside it, so that nothing that view leaves out
-- can ever reach the map by this one, and a record is on the map only if its
-- page is public too.
--
-- `not in` rather than `not exists`. The planner turns `not exists` into an
-- anti-join that probes for every record in the tile, 46,000 probes for a
-- country-zoom tile, which doubled its time locally; `not in` reads the held
-- ids once into a hash and checks each record against that. Its trap, a null
-- in the list making every comparison unknown, cannot spring on a primary
-- key. The index holds the held records only, nearly always none, so reading
-- them costs one page instead of a pass over `reports`. Built only when
-- missing: CREATE INDEX takes SHARE on `reports`, which stops every report
-- being filed while it waits, even when the index exists.
do $$
begin
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and tablename = 'reports'
                    and indexname = 'reports_held_for_classification') then
    create index reports_held_for_classification on public.reports (id)
      where held_for_classification;
  end if;
end $$;

create or replace view public.reports_on_map as
  select p.*
    from reports_public p
   where p.id not in (select h.id
                        from reports h
                       where h.held_for_classification);

comment on view public.reports_on_map is
  'What the map tiles draw: reports_public without the records held at 10 km until the classifier has run (reports.held_for_classification, 0033). Tiles are CDN-cached for up to a day, where a held record''s cell could outlive the blur the model then gives it.';

-- web_anon reads it, as it reads reports_public; nobody else (0013).
revoke all on public.reports_on_map from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.reports_on_map from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'web_anon') then
    grant select on public.reports_on_map to web_anon;
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
