-- Threatened in Taiwan: at least 10 km.
--
-- Until now a record's blur came from TaiCOL's sensitivity rating (敏感度) and
-- the protected-species list. Neither covers every animal Taiwan's national
-- Red List says is at risk. 長腳赤蛙 Rana longicrus is Nationally Vulnerable,
-- has no protection and no sensitivity rating, and its 46 records sat at their
-- exact coordinates; 粉紅鸚嘴's Taiwan subspecies is Nationally Endangered, and
-- its 29 did too. The Taiwan Biodiversity Network, the national portal these
-- records would join, already blurs the Red List's threatened categories. We
-- were publishing more precisely than the country's own portal would.
--
-- So a Red List rating becomes one more term in 0014's strictest-wins rule:
--
--   NCR, NEN, NVU  the Red List's threatened categories (critically
--                  endangered, endangered, vulnerable), as TBN blurs them;
--   RE             regionally extinct: a record would be a rediscovery, and
--                  the first people to hear of a rediscovery should not be
--                  collectors.
--
-- Each gives 'coarse_10km'. NNT (near threatened), NLC, DD, NA and NE add
-- nothing. The rating is read from each row on the way up from a subspecies to
-- its species, like the other two, because TaiCOL puts it on both: 粉紅鸚嘴's is
-- on the subspecies, 長腳赤蛙's on the species.
--
-- It can only tighten. On the local copy of production it moves 102 records
-- from exact to 10 km (72 Vulnerable, 30 Endangered) and changes nothing else;
-- the one-time re-derive at the end goes through tighten_reports(), which
-- cannot loosen a record even where the rules would.
--
-- Decided under the roadmap's question 23 ("also blur species rated
-- Vulnerable or worse on Taiwan's Red List?"), whose default was yes because it
-- only makes locations more private. Undoing it would be a loosening, and would
-- need the owner's decision like any other.

set local lock_timeout = '5s';

/**
 * The blur a Taiwan Red List category asks for, or null for none.
 *
 * A separate function rather than a third argument to precision_from_taxon():
 * that one is called by 0011's and 0012's trigger bodies as well, and changing
 * its signature would leave any of them that a partial re-run restored calling
 * a function that no longer exists.
 */
create or replace function precision_from_redlist(redlist text) returns text
language sql immutable as $$
  select case
    when redlist in ('NCR', 'NEN', 'NVU', 'RE') then 'coarse_10km'
  end
$$;

/**
 * 0014's taxon_precision(), with the Red List term added. Everything else is
 * unchanged, including why it climbs rather than looking one row up.
 */
create or replace function taxon_precision(p_taxon_id bigint) returns text
language plpgsql stable set search_path = public as $$
declare
  cur   record;
  p     text;
  depth int := 0;
begin
  select t.taicol_id, t.parent_taicol_id, t.rank, t.sensitivity, t.protected_status, t.redlist
    into cur
    from taxa t
   where t.id = p_taxon_id;
  if not found then
    return null;
  end if;

  loop
    p := stricter_precision(p, precision_from_taxon(cur.sensitivity, cur.protected_status));
    p := stricter_precision(p, precision_from_redlist(cur.redlist));
    p := stricter_precision(p, (select f.min_precision
                                  from taxon_precision_floors f
                                 where f.taicol_id = cur.taicol_id));

    exit when not coalesce(is_infraspecific(cur.rank), false)
           or cur.parent_taicol_id is null
           or depth >= 6;

    select t.taicol_id, t.parent_taicol_id, t.rank, t.sensitivity, t.protected_status, t.redlist
      into cur
      from taxa t
     where t.taicol_id = cur.parent_taicol_id;
    exit when not found;
    depth := depth + 1;
  end loop;

  return p;
end $$;

/**
 * 0014's re-blur on a taxon change, now also when its Red List rating tightens.
 * A TaiCOL refresh that lists a species as Vulnerable has to re-blur the
 * records it already has, the same way a new sensitivity rating does.
 */
create or replace function reblur_reports_for_taxon() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and precision_rank(precision_from_taxon(new.sensitivity, new.protected_status))
         <= precision_rank(precision_from_taxon(old.sensitivity, old.protected_status))
     and precision_rank(precision_from_redlist(new.redlist))
         <= precision_rank(precision_from_redlist(old.redlist))
     and new.taicol_id        is not distinct from old.taicol_id
     and new.parent_taicol_id is not distinct from old.parent_taicol_id
     and new.rank             is not distinct from old.rank then
    return null;
  end if;

  perform tighten_reports(array(select taxon_and_inheritors(new.taicol_id)));
  return null;
end $$;

-- `redlist` joins the columns that fire it. Replaced in place, as 0014 explains:
-- DROP TRIGGER would take ACCESS EXCLUSIVE on `taxa` for the whole migration.
create or replace trigger taxa_reblur_reports
  after insert or update of sensitivity, protected_status, redlist, parent_taicol_id, rank, taicol_id
  on taxa
  for each row execute function reblur_reports_for_taxon();

-- ---------------------------------------------------------------------------
-- Names whose threatened rating TaiCOL keeps only on a retired twin
-- ---------------------------------------------------------------------------

-- 0014's check that no name in use is blurred less than its retired twin
-- (RETIRED_TWINS_SQL in scripts/taxa-overrides.ts) now counts the Red List
-- too, and finds four plants, none with a record. Floors, as 0014 gave the 37
-- it found; the reasons are in scripts/taxa-overrides.csv. `do nothing` on
-- conflict, so a stricter floor already there is never lowered.
insert into taxon_precision_floors (taicol_id, min_precision, reason) values
  ('t0103426', 'coarse_10km',
   '粗毛懸鉤子 Rubus tephrodes var. setosissimus. Taiwan''s Red List rates this plant Nationally Vulnerable only on a deleted row with the same name, t0059212; the accepted row, the name in use, is unrated. Carried over (10 km) by migration 0021 so naming it by that name blurs it as the retired row would.'),
  ('t0075566', 'coarse_10km',
   '青剛櫟 Quercus glauca. The deleted species row Cyclobalanopsis glauca (t0100790) is rated Nationally Vulnerable; the accepted row is rated Least Concern, which is probably the current assessment. Floored anyway (migration 0021) because a name in use is never blurred less than its retired twin, and a plant costs this site nothing to blur. The owner may lift it.'),
  ('t0059149', 'coarse_10km',
   '青剛櫟 Quercus glauca var. glauca, under t0075566: its retired twin Cyclobalanopsis glauca var. glauca (t0106465) sits under the Nationally Vulnerable deleted species t0100790. Same reasoning as t0075566.'),
  ('t0102121', 'coarse_10km',
   '谷園青剛櫟 Quercus glauca var. kuyuensis, rated Data Deficient: its retired twin Cyclobalanopsis glauca var. kuyuensis (t0106466) sits under the Nationally Vulnerable deleted species t0100790. Same reasoning as t0075566.')
on conflict (taicol_id) do nothing;

-- Once: every record brought up to the new rule, tightening only.
select tighten_reports(null);
