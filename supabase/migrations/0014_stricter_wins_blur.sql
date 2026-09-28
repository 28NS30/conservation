-- Stricter wins: a record's blur is the strictest answer any rule gives.
--
-- Until now one row decided. `set_report_public_location()` read the
-- sensitivity and protection of the record's own taxon and nothing else, so
-- every way that row can be too lenient was a way to publish a protected
-- animal's exact position. Three of them are live:
--
--   1. TaiCOL rates sensitivity on SPECIES rows. Among the 1,241 accepted taxa
--      it rates 輕度 there is not one animal subspecies. A record filed under a
--      subspecies therefore read "unrated" even when its species is rated:
--      棕背伯勞 Lanius schach schach (15 records) and 小水鴨 Anas crecca crecca
--      (8) sit at their exact coordinates while TaiCOL rates both species 輕度.
--      PR #52 stamped precision_override on subspecies records whose species
--      carried a rating in our copy; these two species were rated after our
--      copy was taken, so nothing covered them.
--
--   2. The law and TaiCOL disagree about names. The 2025 protected-species list
--      protects Taiwan's glass lizard as class II under its old name, Dopasia
--      harti. TaiCOL now calls the Taiwan animal Dopasia formosensis
--      (t0028707), with no protection and no rating, and moved the class II to
--      a D. harti row that is not in Taiwan. A report of 臺灣蛇蜥 today is
--      published to the metre. A hand edit to t0028707 would not last:
--      scripts/import-taicol.ts overwrites protected_status and sensitivity on
--      every run.
--
--   3. TaiCOL keeps duplicates. 戈芬氏鳳頭鸚鵡 is two accepted rows: Cacatua
--      goffiniana is protected class I and rated 輕度; Cacatua goffini
--      (t0125438) is neither. The law lists goffini as a synonym of goffiniana.
--      A report on the second row publishes a class I bird exactly.
--
-- And 0012, which exists to re-blur records when a rating tightens, could
-- itself loosen one; see tighten_reports() below.
--
-- So the rule becomes: the strictest of
--
--   * the record's own taxon (TaiCOL's sensitivity, else its protection),
--   * for a subspecies, variety or form, each row above it up to and including
--     its species, and
--   * a FLOOR, a local minimum kept in `taxon_precision_floors`, keyed by
--     TaiCOL id, for every one of those rows,
--   * and, as before, the record's own precision_override, and the 10 km blur
--     for a record nobody has identified (0011).
--
-- Every term can only make the answer stricter. Nothing here can publish a
-- coordinate that was withheld yesterday; the proof is in
-- apps/web/test/stricter-wins.test.mjs, and the one-time re-derive at the end
-- is written so that it cannot loosen a record even where the rules would.
--
-- THE FLOORS ARE OURS, NOT TaiCOL's. The import writes `taxa` and never this
-- table, so a floor survives every refresh. Its source of truth is the
-- committed file scripts/taxa-overrides.csv, which says why each one exists;
-- the rows below are that file as it stood when this migration was written,
-- and scripts/apply-taxa-overrides.ts applies later edits. Besides the three
-- cases above it holds four species TaiCOL has rated since our copy was taken
-- (their 30 records tighten here, without waiting for a refresh), and four
-- whose protection or rating a refresh would weaken. A floor can only add
-- blur. Removing one does not un-blur the records it covered, for the same
-- reason 0012 refuses to: publishing a withheld location is a decision.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

/** The stricter of two precisions. Either may be null, meaning "no opinion". */
create or replace function stricter_precision(a text, b text) returns text
language sql immutable as $$
  select case
    when a is null then b
    when b is null then a
    when precision_rank(b) > precision_rank(a) then b
    else a
  end
$$;

/**
 * Ranks that sit below a species and inherit its rating.
 *
 * TaiCOL's own vocabulary, as it appears in `taxa.rank`. 'Hybrid Formula' is
 * not here: a hybrid is not a part of one species, and there is no single
 * parent whose rating it could inherit.
 */
create or replace function is_infraspecific(rank text) returns boolean
language sql immutable as $$
  select rank in ('Subspecies', 'Variety', 'Form', 'Special Form')
$$;

-- ---------------------------------------------------------------------------
-- Floors
-- ---------------------------------------------------------------------------

create table if not exists taxon_precision_floors (
  -- TaiCOL's id rather than `taxa.id`: `taxa.id` is a bigserial that a fresh
  -- import renumbers, and the floor has to find the same animal afterwards.
  -- No foreign key for the same reason, and because the floor must be able to
  -- exist before the taxon does — CI applies every migration to an empty
  -- database and loads taxa afterwards.
  taicol_id     text primary key,
  -- 'exact' is not a floor. A row that says so would be a loosening written
  -- in a place built only to tighten, so it is refused rather than ignored.
  min_precision text not null
                check (min_precision in ('coarse_10km', 'coarse_50km', 'suppressed')),
  reason        text not null check (length(btrim(reason)) > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table taxon_precision_floors is
  'Local minimum blur per TaiCOL id. Never written by the TaiCOL import. Source of truth: scripts/taxa-overrides.csv.';

-- Nobody outside the server reads this. 0013 already revoked the default
-- grants to anon and authenticated, so the table is closed on creation; RLS is
-- the second layer, as 0013 did for `taxa`, so one stray grant does not open it.
alter table taxon_precision_floors enable row level security;

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

/**
 * The precision a taxon's records must carry at least.
 *
 * Climbs from the taxon to its species through `parent_taicol_id`, taking
 * each row's own TaiCOL rating and its floor, and returns the strictest.
 * 44 infraspecific rows in TaiCOL sit under another infraspecific row rather
 * than directly under a species, which is why this climbs rather than looking
 * one row up. The depth limit is a guard against a cycle in the source data,
 * not a limit anything reaches.
 *
 * Null for an id that is not in `taxa`; callers decide what that means.
 *
 * PL/pgSQL rather than one recursive SQL query, for speed and nothing else:
 * this runs for every report written, and Postgres 17 plans a SQL function's
 * body afresh on every call where PL/pgSQL keeps its plans. Measured on the
 * local copy, re-deriving all 46k records took 10.7 s written as a recursive
 * CTE and 3.1 s written like this.
 */
create or replace function taxon_precision(p_taxon_id bigint) returns text
language plpgsql stable set search_path = public as $$
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
end $$;

/**
 * The precision a record must be published at.
 *
 * No taxon means nobody has identified it, which is not the same as "not
 * sensitive" (0011); that stays 'coarse_10km' and matches
 * UNIDENTIFIED_PRECISION on the submission path (packages/shared), so a
 * report blurred while it waits for identification is not un-blurred by
 * arriving through a different door. A taxon id with no row behind it is
 * treated the same way, for the same reason.
 *
 * The override can tighten this and never loosen it.
 */
create or replace function report_precision(p_taxon_id bigint, p_override text)
returns text
language sql stable set search_path = public as $$
  select stricter_precision(
           case when p_taxon_id is null then 'coarse_10km'
                else coalesce(taxon_precision(p_taxon_id), 'coarse_10km')
           end,
           p_override)
$$;

-- `set search_path = public` is load-bearing, not decoration: pg_dump emits
-- `set_config('search_path', '', false)` before COPY, so an unqualified `taxa`
-- reference in this trigger fails during any data restore. (0003.)
create or replace function set_report_public_location() returns trigger
language plpgsql set search_path = public as $$
declare
  p text;
begin
  -- One function decides, and the re-derive below asks the same one. If the
  -- trigger and the re-derive could disagree, the re-derive's "is this now
  -- stricter?" test would be answering a different question from the one the
  -- trigger then acts on.
  p := report_precision(new.taxon_id, new.precision_override);

  new.location_precision := p;
  new.location_public := case
    when p = 'exact' then new.location
    else obscure_point(new.location, new.id, precision_cell_deg(p))
  end;
  return new;
end $$;

-- The trigger itself is unchanged from 0003: before insert or update of
-- location, taxon_id, precision_override.

-- ---------------------------------------------------------------------------
-- Re-deriving, tightening only
-- ---------------------------------------------------------------------------

/**
 * A taxon and every row that inherits its rating: its subspecies, varieties
 * and forms, and theirs.
 */
create or replace function taxon_and_inheritors(p_taicol_id text)
returns setof bigint
language sql stable set search_path = public as $$
  with recursive down as (
    select t.id, t.taicol_id, 0 as depth
      from taxa t
     where t.taicol_id = p_taicol_id
    union all
    select c.id, c.taicol_id, d.depth + 1
      from down d
      join taxa c on c.parent_taicol_id = d.taicol_id
     where is_infraspecific(c.rank)
       and d.depth < 6
  )
  select id from down
$$;

/**
 * Re-derive the records the rules now blur harder than they are blurred.
 *
 * `p_taxon_ids` null means every record; an empty array means none.
 *
 * THE GUARD IS THE POINT. 0012 decided whether to re-derive by comparing a
 * taxon's old rating with its new one, and then re-derived every record of
 * that taxon from scratch. A record can already be stricter than its taxon's
 * current rating — 0012 itself leaves records blurred when a rating is
 * withdrawn — so a later, unrelated tightening re-derived it DOWN: withdrawn
 * 重度 (50 km, kept), then a new class III listing (10 km, "stricter than
 * unrated"), and the record went from 50 km to 10 km. Comparing each record's
 * own current precision with what the rules now say for it is the only test
 * that cannot loosen anything, and it is the one used here.
 *
 * Assigning `location` to itself re-fires the BEFORE trigger, which is what
 * recomputes location_precision and location_public. `obscure_point` is
 * deterministic per record id, so a record re-derived twice lands in the same
 * place.
 */
create or replace function tighten_reports(p_taxon_ids bigint[]) returns bigint
language plpgsql set search_path = public as $$
declare
  n bigint;
begin
  update reports r
     set location = r.location
   where (p_taxon_ids is null or r.taxon_id = any (p_taxon_ids))
     and precision_rank(report_precision(r.taxon_id, r.precision_override))
         > precision_rank(r.location_precision);
  get diagnostics n = row_count;
  return n;
end $$;

-- A taxon's rating moved. Replaces 0012's version, which re-derived only the
-- taxon's own records; a species newly rated 輕度 left its subspecies'
-- records exact, and those are where TaiCOL's birds mostly are.
create or replace function reblur_reports_for_taxon() returns trigger
language plpgsql set search_path = public as $$
begin
  -- A routine re-import rewrites every column of all 125k rows, and this
  -- fires for each. The early exit keeps that free: nothing that can make a
  -- record stricter has changed. The guard in tighten_reports() is what makes
  -- the work SAFE; this only makes it rare.
  if tg_op = 'UPDATE'
     and precision_rank(precision_from_taxon(new.sensitivity, new.protected_status))
         <= precision_rank(precision_from_taxon(old.sensitivity, old.protected_status))
     and new.taicol_id        is not distinct from old.taicol_id
     and new.parent_taicol_id is not distinct from old.parent_taicol_id
     and new.rank             is not distinct from old.rank then
    return null;
  end if;

  perform tighten_reports(array(select taxon_and_inheritors(new.taicol_id)));
  return null;
end $$;

drop trigger if exists taxa_reblur_reports on taxa;

-- Also on insert: a species row imported after its subspecies already hold
-- records is a new rating for those records. And on parent_taicol_id, rank and
-- taicol_id, because each of those changes which rows a record inherits from.
create trigger taxa_reblur_reports
  after insert or update of sensitivity, protected_status, parent_taicol_id, rank, taicol_id
  on taxa
  for each row execute function reblur_reports_for_taxon();

-- A floor was added or raised. Lowering or deleting one re-derives nothing,
-- by the guard: the records keep what they have until a person loosens them.
create or replace function reblur_reports_for_floor() returns trigger
language plpgsql set search_path = public as $$
begin
  perform tighten_reports(array(select taxon_and_inheritors(new.taicol_id)));
  return null;
end $$;

drop trigger if exists taxon_precision_floors_reblur on taxon_precision_floors;

create trigger taxon_precision_floors_reblur
  after insert or update on taxon_precision_floors
  for each row execute function reblur_reports_for_floor();

-- ---------------------------------------------------------------------------
-- A photograph cannot tell subspecies apart
-- ---------------------------------------------------------------------------

/** 'Genus epithet' of a scientific name, lower-cased: what a photo can name. */
create or replace function binomial_of(name text) returns text
language sql immutable as $$
  select lower(split_part(name, ' ', 1) || ' ' || split_part(name, ' ', 2))
$$;

/**
 * The strictest precision among every row sharing this taxon's binomial.
 *
 * The classifier's labels include subspecies, deleted rows and duplicates,
 * and softmax splits between look-alike rows, so which of several same-name
 * rows it lands on is noise. Even with the species rule above, measured on
 * the local copy, 199 labels in 132 binomials carry a looser rule than a row
 * sharing their binomial. One of them was a second, deleted 'Dopasia
 * formosensis' (t0124331), still a label and unrated beside the row the law
 * protects. It has a floor of its own below; the other 198 are why this is a
 * rule and not a list.
 */
create or replace function binomial_precision(p_taxon_id bigint) returns text
language sql stable set search_path = public as $$
  select p
    from (select taxon_precision(s.id) as p
            from taxa t
            join taxa s on binomial_of(s.scientific_name) = binomial_of(t.scientific_name)
           where t.id = p_taxon_id) x
   order by precision_rank(p) desc
   limit 1
$$;

/**
 * The override an identification made from a photograph has to carry: the
 * binomial's strictest rule when it is stricter than the taxon's own, and
 * null when it adds nothing.
 *
 * Null rather than a redundant stamp because a stamp on an identified record
 * is treated as a deliberate decision by every later correction
 * (keepDeliberateOverride in apps/web/lib/report/precision.ts), and a stamp
 * that duplicated the taxon's own rule would outlive a moderator correcting
 * the species to one that needs none.
 */
create or replace function binomial_precision_floor(p_taxon_id bigint) returns text
language sql stable set search_path = public as $$
  select case when precision_rank(b) > precision_rank(o) then b end
    from (select binomial_precision(p_taxon_id) as b,
                 taxon_precision(p_taxon_id)    as o) x
$$;

-- ---------------------------------------------------------------------------
-- The first floors: scripts/taxa-overrides.csv, as committed with this file
-- ---------------------------------------------------------------------------

-- `do nothing` on conflict: if a floor already exists it was put there on
-- purpose, possibly stricter than this, and re-running a migration must not
-- lower it.
insert into taxon_precision_floors (taicol_id, min_precision, reason) values
  ('t0028707', 'coarse_10km',
   '臺灣蛇蜥 Dopasia formosensis. The 2025-02-07 protected-species list protects the Taiwan animal as class II under its old name Dopasia harti; TaiCOL moved that status to a D. harti row not in Taiwan on 2026-04-24 and left this row unprotected and unrated.'),
  ('t0124331', 'coarse_10km',
   '臺灣蛇蜥 again: a deleted TaiCOL row for Dopasia formosensis, unrated, beside t0028707. The species picker and the report form refuse deleted names, but the classifier''s label list still holds this one.'),
  ('t0125438', 'coarse_10km',
   '戈芬氏鳳頭鸚鵡 Cacatua goffini. A second accepted TaiCOL row for the bird whose other row, Cacatua goffiniana t0076951, is protected class I and rated 輕度. The protected-species list names goffini as its synonym.'),
  ('t0096004', 'coarse_10km',
   '棕背伯勞 Lanius schach. TaiCOL rates the species 輕度 (checked 2026-09-28); our copy predates the rating. Covers the subspecies L. s. schach, which holds the records.'),
  ('t0099969', 'coarse_10km',
   '小水鴨 Anas crecca. TaiCOL rates the species 輕度 (checked 2026-09-28); our copy predates the rating. Covers the subspecies A. c. crecca, which holds the records.'),
  ('t0097440', 'coarse_10km',
   '黑腹濱鷸 Calidris alpina. TaiCOL rates it 輕度 (checked 2026-09-28); our copy predates the rating.'),
  ('t0077070', 'coarse_10km',
   '紅胸濱鷸 Calidris ruficollis. TaiCOL rates it 輕度 (checked 2026-09-28); our copy predates the rating.'),
  ('t0097786', 'coarse_10km',
   '花翅山椒鳥, our row Coracina macei. The protected-species list names Coracina macei class II. TaiCOL has since renamed this row Coracina javensis and removed its protection, so a refresh would publish new reports exactly.'),
  ('t0066574', 'coarse_50km',
   '黃魚鴞 Ketupa flavipes. Our copy rates it 重度; TaiCOL relaxed it to 輕度 on 2026-08-12. Kept at the stricter level until the owner decides otherwise.'),
  ('t0098180', 'coarse_50km',
   '黃鸝 Oriolus chinensis. Our copy rates it 重度; TaiCOL relaxed it to 輕度 on 2026-08-12. Kept at the stricter level until the owner decides otherwise.'),
  ('t0098063', 'coarse_50km',
   '熊鷹 Nisaetus nipalensis. Our copy rates it 重度; TaiCOL relaxed it to 輕度 on 2026-08-12. Kept at the stricter level until the owner decides otherwise.')
on conflict (taicol_id) do nothing;

-- ---------------------------------------------------------------------------
-- Once: every record, re-derived under the rules above, tightening only
-- ---------------------------------------------------------------------------

-- 0012 had no backfill, because its rule was unchanged and only its trigger
-- was new. This one changes the rule, so the records already published under
-- the old one have to be brought up to it. The floor inserts above have
-- already done this for the records of those taxa; this is everything else —
-- subspecies under species rated before today, above all.
--
-- On the local copy of production this tightens the 23 subspecies records and
-- the 7 shorebird records to 10 km and changes nothing else. Records the new
-- rules would leave LOOSER than they are now are not touched at all: see the
-- guard in tighten_reports().
select tighten_reports(null);
