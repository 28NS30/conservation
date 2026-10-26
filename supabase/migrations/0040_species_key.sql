-- Name each species once: the species a subspecies belongs to, and which
-- subspecies the directory, the invasive list and the picker show as part of
-- it.
--
-- TaiCOL lists 家燕 Hirundo rustica as a species row and three subspecies
-- rows, every one of them called 家燕. The directory printed one card per row,
-- so a reader saw 家燕 three times with the same title and the records split
-- between them, and 紅尾伯勞, 大卷尾, 洋燕 and others the same way. On
-- production on 26 October 2026 the 504 rows the directory listed held 13
-- such names on 32 rows and 747 records. The invasive list had 11 names twice,
-- and a student who searched 埃及聖䴉 could open the species row, which has no
-- record, while the subspecies row beside it held all six.
--
-- From here a subspecies with its species' Chinese name is shown as part of
-- the species:
--
--   * `taxa.species_taicol_id`: for a subspecies, variety or form, the
--     species it belongs to, found by climbing parent_taicol_id through the
--     infraspecific ranks, as taxon_precision() climbs them. Null on a
--     species, which is its own, and above it. Set only below species
--     because that is all a card asks, and because writing it on all 90,000
--     species rows too would rewrite two thirds of taxa (188 MB with its
--     indexes on production, each index taking a new entry for every row
--     written) in a database the free plan stops at 500 MB. Below species
--     the fill writes 5,573 rows.
--     resolve_species_keys() fills it, and resolve_taxa_lineage(), which both
--     TaiCOL imports end with, now calls it, so a refresh keeps it current.
--   * `species_folds`: each subspecies shown on its species' card. 1,508
--     on production, 148 of them with records (10,754 records). A
--     subspecies with a name of its own, 石虎 under 豹貓, keeps its own card.
--     So do two subspecies that share a name their species does not use:
--     neither is the other's species, and one card would put each one's
--     records on the other's page. Two such names stay twice on the
--     invasive list, 環頸雉 and 黑頭文鳥, each two introduced subspecies of a
--     native, protected species; the list goes from 209 lines to 200.
--   * `species_card_members` and `species_card_stats`: the rows a card
--     covers, and its records counted over them. The directory's 504 rows
--     are 485 cards.
--
-- A subspecies never folds into a species blurred by another rule. Every row
-- on a card has the same taxon_precision(), so the blur a species page states
-- is the blur of every record behind it; and the same TaiCOL invasive flag,
-- so the invasive list and the invasive report page offer only invasive
-- animals. taxon_precision() reads the floors table, which web_anon may not,
-- so the comparison is one SECURITY DEFINER function that answers yes or no
-- about two taxa, executable by web_anon alone, as 0025 does for the model's
-- suggestions. It says nothing the two species' pages do not. It is asked
-- only where a subspecies has a rating, protection or floor of its own; the
-- rest take their species' rule by construction (species_folds, below). On
-- production 2 same-named subspecies are blurred differently from their
-- species, and neither has a record.
--
-- DISPLAY ONLY. No record moves and no record's taxon, blur or override
-- changes: the fill writes one new column, and the re-blur trigger on taxa
-- (0012, 0026) fires only on the columns a rating is derived from. The check
-- at the end refuses the migration if any record differs from before it.
-- POST /api/reports still files under every name it accepted, subspecies
-- included, so a report queued offline under one still goes through.
--
-- Safe to re-run.

set local lock_timeout = '5s';

-- Every record as it stands, to compare with at the end. Session temp table,
-- dropped at the end, as 0029 does.
drop table if exists pg_temp.reports_before_0040;
create temp table reports_before_0040 as
  select r.id, r.taxon_id, r.location_precision, r.precision_override,
         r.is_obscured, r.status, md5(r.location_public::text) as at
    from reports r;

-- Only when it is missing. ALTER TABLE takes ACCESS EXCLUSIVE even when it
-- changes nothing, and every report insert reads taxa through the trigger
-- (0014), so a re-run would hold submissions for as long as it waited.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'taxa'
                    and column_name = 'species_taicol_id') then
    alter table taxa add column species_taicol_id text;
    comment on column taxa.species_taicol_id is
      'For a subspecies, variety or form: the taicol_id of the species it belongs to, climbing parent_taicol_id through the infraspecific ranks. Null on a species and above. Filled by resolve_species_keys(). Display only: no blur reads it.';
  end if;
end $$;

-- A subspecies' species is looked up by taicol_id, which is unique already;
-- this is the other way, a species' subspecies. Partial: most rows have none.
create index if not exists taxa_species_taicol_id_idx on taxa (species_taicol_id)
  where species_taicol_id is not null;

create or replace function public.resolve_species_keys()
returns bigint
language plpgsql
set search_path = public
as $$
declare
  n bigint;
begin
  -- The same climb as taxon_precision(): from an infraspecific row through
  -- each infraspecific parent, at most six levels, to the species above. A
  -- row whose chain ends at anything but a species (a subspecies filed
  -- directly under a genus) has no species, and is its own card. A row that
  -- has stopped being infraspecific since the last fill loses its key.
  with recursive up as (
    select t.id as root_id, t.taicol_id, t.parent_taicol_id, t.rank, 0 as depth
      from taxa t
     where coalesce(is_infraspecific(t.rank), false)
    union all
    select u.root_id, p.taicol_id, p.parent_taicol_id, p.rank, u.depth + 1
      from up u
      join taxa p on p.taicol_id = u.parent_taicol_id
     where coalesce(is_infraspecific(u.rank), false)
       and u.depth < 6
  ),
  keyed as (
    select root_id as id, max(taicol_id) filter (where rank = 'Species') as species_taicol_id
      from up
     group by root_id
    union all
    select t.id, null
      from taxa t
     where t.species_taicol_id is not null
       and not coalesce(is_infraspecific(t.rank), false)
  )
  update taxa t
     set species_taicol_id = k.species_taicol_id
    from keyed k
   where t.id = k.id
     and t.species_taicol_id is distinct from k.species_taicol_id;
  get diagnostics n = row_count;
  return n;
end
$$;

comment on function public.resolve_species_keys() is
  'Fills taxa.species_taicol_id from parent_taicol_id. Called by resolve_taxa_lineage(); returns the rows it changed.';

-- 0002's function, unchanged but for the call to resolve_species_keys()
-- before it returns.
create or replace function resolve_taxa_lineage() returns bigint
language plpgsql set search_path = public as $$
declare
  n bigint;
begin
  with recursive lineage as (
    -- Seed: every taxon is its own ancestor at depth 0.
    select t.id as root_id, t.taicol_id, t.parent_taicol_id,
           t.rank, t.scientific_name, 0 as depth
    from taxa t
    union all
    -- Climb one level toward the root.
    select l.root_id, p.taicol_id, p.parent_taicol_id,
           p.rank, p.scientific_name, l.depth + 1
    from lineage l
    join taxa p on p.taicol_id = l.parent_taicol_id
    where l.depth < 40                      -- guard against a cycle in the source data
  ),
  agg as (
    select root_id,
      max(scientific_name) filter (where rank = 'Kingdom') as kingdom,
      max(scientific_name) filter (where rank = 'Phylum')  as phylum,
      max(scientific_name) filter (where rank = 'Class')   as class,
      max(scientific_name) filter (where rank = 'Order')   as ord,
      max(scientific_name) filter (where rank = 'Family')  as family,
      max(scientific_name) filter (where rank = 'Genus')   as genus
    from lineage
    group by root_id
  )
  update taxa t
     set kingdom = a.kingdom, phylum = a.phylum, class = a.class,
         "order" = a.ord,     family = a.family, genus  = a.genus
    from agg a
   where t.id = a.root_id;

  get diagnostics n = row_count;

  -- BioCLIP was trained on taxonomic hierarchy strings, so the text side must be
  -- the lineage — not a bare or colloquial name. `scientific_name` already carries
  -- "Genus species", so genus is not repeated.
  --
  -- Chinese vernaculars are deliberately excluded: CLIP's text encoder is
  -- English-trained and they would add noise. They remain for display only.
  update taxa
     set bioclip_prompt = 'a photo of '
         || nullif(concat_ws(' ', kingdom, phylum, class, "order", family), '')
         || ' ' || scientific_name || '.'
   where rank in ('Species','Subspecies','Variety','Form')
     and is_in_taiwan;

  -- Which species each row belongs to (0040), from the same parents.
  perform resolve_species_keys();

  return n;
end $$;

comment on function resolve_taxa_lineage is
  'Walks parent_taicol_id to fill kingdom..genus and species_taicol_id, then builds bioclip_prompt for Taiwan species. Run after import-taicol.';

-- Whether two taxa are blurred by the same rule, asked of taxon_precision()
-- itself, for the subspecies species_folds cannot settle from their own row
-- (below).
create or replace function public.same_taxon_precision(a bigint, b bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
-- Dear on purpose: two walks of the taxon chain, about 0.1 ms locally and
-- 0.4 ms on production. The planner then checks every cheaper condition on a
-- pair first, and prefers working out the few folds a query asks about to
-- working out all 1,500.
cost 10000
as $$
  select taxon_precision(a) is not distinct from taxon_precision(b)
$$;

comment on function public.same_taxon_precision(bigint, bigint) is
  'Whether taxon_precision() gives two taxa the same blur. species_folds keeps rows apart when not.';

revoke execute on function public.same_taxon_precision(bigint, bigint) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.same_taxon_precision(bigint, bigint) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'web_anon') then
    grant execute on function public.same_taxon_precision(bigint, bigint) to web_anon;
  end if;
end $$;

-- Each subspecies shown on its species' card, and that species.
--
-- Both rows are names the picker offers (OFFERED in apps/web/lib/species.ts):
-- accepted and in Taiwan. The species has the subspecies' Chinese name, its
-- invasive flag, its kingdom and its blur.
--
-- Most subspecies carry nothing of their own that a blur is made from, and
-- for those the rule is their species' by construction, so the view asks
-- taxon_precision() only of the rest: 104 of 1,510 same-named subspecies on
-- production. It has to: a call there costs about 0.4 ms, and asking it of
-- every pair took 2.1 s, which the directory's "all" count and list would
-- each have paid. If taxon_precision() ever reads another column, that
-- column belongs in the shortcut below; test/species-cards.test.mjs checks
-- every fold against taxon_precision() itself. The floors are read here as
-- the view's owner, so web_anon still has no grant on them.
--
-- The species is looked up by its unique taicol_id in a LIMIT 1 subquery
-- rather than joined, and that is for the planner. Joined, it guessed that
-- one subspecies in all of taxa matches its species on name and flag, read
-- the view as one row, and compared that row with every row of a 44,000-row
-- directory count: 2.5 s locally. The LIMIT keeps the lookup a subquery, one
-- per subspecies, so the view is estimated at about its true size, and a
-- query asking about a few rows works out only those.
create or replace view species_folds as
  select m.id as taxon_id, s.id as species_id
    from taxa m
    cross join lateral (
      select s.id
        from taxa s
       where s.taicol_id = m.species_taicol_id
         and s.rank = 'Species'
         and s.taxon_status is not distinct from 'accepted' and s.is_in_taiwan
         and s.common_name_zh = m.common_name_zh
         and s.is_invasive = m.is_invasive
         and s.kingdom is not distinct from m.kingdom
         -- The blur. A subspecies directly under its species, with no rating,
         -- no protection and no floor of its own, takes exactly its species'
         -- rule: taxon_precision() reads those three of each row it climbs
         -- through, from the subspecies to the species, and nothing else.
         -- Any other subspecies is asked of taxon_precision() itself.
         and ((m.parent_taicol_id = s.taicol_id
               and m.sensitivity is null
               and coalesce(m.protected_status, '') = ''
               and not exists (select 1 from taxon_precision_floors fl
                                where fl.taicol_id = m.taicol_id))
              or same_taxon_precision(s.id, m.id))
       limit 1
    ) s
   where m.rank = 'Subspecies'
     and m.taxon_status is not distinct from 'accepted' and m.is_in_taiwan
     and m.species_taicol_id is not null
     and m.common_name_zh is not null;

comment on view species_folds is
  'Each subspecies shown on its species'' card (0040): the same Chinese name, invasive flag, kingdom and taxon_precision(). Display only.';

-- The rows behind each card: the card itself and the subspecies folded into
-- it. Every taxon is a card of itself here, a folded subspecies included, so
-- its own page still shows its own records. Filter on card_id: the second half
-- then reads only that species' subspecies, through the species key.
create or replace view species_card_members as
  select x.id as card_id, x.id as taxon_id
    from taxa x
  union all
  select x.id as card_id, f.taxon_id
    from taxa x
    join taxa m on m.species_taicol_id = x.taicol_id and m.id <> x.id
    join species_folds f on f.taxon_id = m.id and f.species_id = x.id;

comment on view species_card_members is
  'Which taxa a card covers (0040): the taxon, and for a species the subspecies species_folds puts on its card. Filter on card_id.';

-- species_report_stats (0005) by card: a folded subspecies' records count on
-- its card, and the subspecies has no row of its own here.
create or replace view species_card_stats as
  select coalesce(f.species_id, s.taxon_id) as taxon_id,
         sum(s.report_count)::int           as report_count,
         min(s.first_seen)                  as first_seen,
         max(s.last_seen)                   as last_seen
    from species_report_stats s
    left join species_folds f on f.taxon_id = s.taxon_id
   group by 1;

comment on view species_card_stats is
  'species_report_stats counted by card (0040). Built on reports_public, like it.';

grant select on species_folds, species_card_members, species_card_stats to web_anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on species_folds, species_card_members, species_card_stats from anon, authenticated;
  end if;
end $$;

do $$
begin
  perform resolve_species_keys();
end $$;

-- Nothing about any record may differ: not its taxon, its blur, its override,
-- whether it is obscured, its status or the point it is published at.
do $$
declare
  changed bigint;
begin
  select count(*) into changed
    from (
      select id, taxon_id, location_precision, precision_override, is_obscured, status,
             md5(location_public::text) as at
        from reports
      except
      select id, taxon_id, location_precision, precision_override, is_obscured, status, at
        from pg_temp.reports_before_0040
    ) d;
  if changed > 0
     or (select count(*) from reports) <> (select count(*) from pg_temp.reports_before_0040) then
    raise exception '0040 would change % record(s); it changes taxa only', changed;
  end if;
end $$;

drop table pg_temp.reports_before_0040;
