-- Blur for protected and poaching-risk species only (owner decision, 30
-- September 2026).
--
-- The team asked that only protected species be blurred, with IUCN and the
-- risk of poaching in mind, and that no invasive species be blurred. The
-- owner decided four things, each from options with the records they move:
--
--   1. A record whose species is invasive, named by the reporter or by the
--      model, is published at its exact spot. The invasive page used to hold
--      every report at 10 km until a moderator checked it, since a protected
--      native can be mistaken for its invasive look-alike; that hold goes. A
--      species that is invasive AND protected or rated (some cockatoos, 九官鳥)
--      is still blurred by its own rating, and a moderator who names a
--      protected species re-blurs the record then.
--   2. A record with no species named stays at 10 km until it is named (0011).
--   3. The blur comes from the Wildlife Conservation Act's protected list and
--      TaiCOL's sensitivity ratings (Taiwan's poaching-risk list), and no
--      longer from Taiwan's Red List. 0021's Red List term is removed, and the
--      three floors that existed only to keep a Red List rating go with it.
--   4. TaiCOL's 重度 stays at 50 km and 座標不開放 stays hidden.
--
-- On production when this was written: 102 records blurred only by the Red
-- List and 15 more held there by a stamp from the 29 September name
-- correction become exact, as do 16 records of invasive species (14 dogs, the
-- two tree frogs reported from the invasive page on 30 September). Nothing
-- else may loosen; the check at the end refuses the migration if it would.
--
-- Safe to re-run.

set local lock_timeout = '5s';

-- What is blurred now, and why, before the rule changes. Session temp tables,
-- dropped at the end: `on commit drop` vanishes at once where each statement
-- is its own transaction, as when CI applies migrations file by file.
drop table if exists pg_temp.blurred_before;
drop table if exists pg_temp.loosen;
create temp table blurred_before as
  select r.id, r.location_precision, taxon_precision(r.taxon_id) as taxon_rule
    from reports r
   where r.location_precision <> 'exact';

-- 3. The Red List term, removed. The rest is 0021's taxon_precision() as it was.
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

-- The floors that existed only to keep a Red List rating a TaiCOL refresh
-- removed. Floors that also keep a sensitivity rating (革舌蕨) stay.
delete from taxon_precision_floors
 where taicol_id in ('t0103426', 't0103277', 't0103284');

-- 1 and 3, on the records already published. A record loosens only when its
-- species' own rule and its binomial's are now exact, and only for the two
-- reasons decided: the Red List term is gone, or the species is invasive and
-- otherwise unrated. Its override goes too, whatever set it: the invasive
-- page's hold, or the stamp the name correction left to keep a Red List blur.
create temp table loosen as
  select r.id
    from reports r
    join taxa t on t.id = r.taxon_id
    join blurred_before b on b.id = r.id
   where taxon_precision(r.taxon_id) = 'exact'
     and binomial_precision(r.taxon_id) = 'exact'
     and (b.taxon_rule is distinct from 'exact' or t.is_invasive);

update reports r
   set precision_override = null
  from loosen l
 where r.id = l.id;

-- Anything else that no longer matches its rule is left as it is: this
-- migration loosens nothing it was not asked to.
do $$
declare
  other bigint;
begin
  select count(*) into other
    from reports r
    join blurred_before b on b.id = r.id
   where r.location_precision = 'exact'
     and r.id not in (select id from loosen);
  if other > 0 then
    raise exception '0029 would loosen % record(s) outside the decision', other;
  end if;
end $$;

drop table pg_temp.loosen;
drop table pg_temp.blurred_before;
