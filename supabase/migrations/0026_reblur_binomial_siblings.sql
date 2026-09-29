-- When a rating tightens, re-blur the records named under its binomial too.
--
-- A species named from a photograph is blurred at least as hard as the
-- strictest row sharing its binomial (binomial_precision_floor, 0014): a model
-- cannot tell a protected endemic subspecies from the rest of its species, and
-- confirmSpecies and the classifier both stamp that floor when they name one.
-- But the stamp was computed once, when the record was named. The re-blur
-- triggers (0012, 0014) reach only the taxon that changed and the rows that
-- inherit from it, so when TaiCOL, a floor or the Red List later tightened a
-- SUBSPECIES, a record named at the species level from a photo stayed as it
-- was: exact, beside a sibling that now asks for 10 or 50 km.
--
-- tighten_binomial_siblings closes that. For the taxa that tightened, it finds
-- every record named under any row sharing their binomial and raises its
-- override to the binomial's strictest rule where that is stricter than the
-- record's blur now. It only ever tightens (stricter_precision with what is
-- there), and it leaves GBIF imports ('imported') alone: they carry their own
-- taxon's rule and were never stamped with the floor.
--
-- The model's suggestion lists need nothing here: 0025 checks each candidate's
-- blur when the list is read, so a candidate that tightens leaves its list at
-- once.
--
-- Safe to re-run.

set local lock_timeout = '5s';

create or replace function public.tighten_binomial_siblings(p_taxon_ids bigint[])
returns bigint
language plpgsql
as $$
declare
  n bigint;
begin
  update reports r
     set precision_override = stricter_precision(r.precision_override,
                                                 binomial_precision(r.taxon_id))
   where r.taxon_id in (
           select s.id
             from taxa t
             join taxa s
               on binomial_of(s.scientific_name) = binomial_of(t.scientific_name)
              and (s.kingdom is null or t.kingdom is null or s.kingdom = t.kingdom)
            where t.id = any (p_taxon_ids))
     and r.taxon_source in ('ai', 'user', 'expert')
     and precision_rank(binomial_precision(r.taxon_id))
         > precision_rank(r.location_precision);
  get diagnostics n = row_count;
  return n;
end
$$;

create or replace function public.reblur_reports_for_taxon()
returns trigger
language plpgsql
as $$
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
  perform tighten_binomial_siblings(array[new.id]);
  return null;
end
$$;

create or replace function public.reblur_reports_for_floor()
returns trigger
language plpgsql
as $$
begin
  perform tighten_reports(array(select taxon_and_inheritors(new.taicol_id)));
  perform tighten_binomial_siblings(array(select t.id from taxa t where t.taicol_id = new.taicol_id));
  return null;
end
$$;

-- Not a public endpoint (0024). The default privileges already keep a new
-- function closed; this says so for this one, in case the migration is run by
-- a role whose defaults differ.
revoke execute on function public.tighten_binomial_siblings(bigint[]) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.tighten_binomial_siblings(bigint[]) from anon, authenticated;
  end if;
end $$;

-- Records already named before this migration, whose siblings tightened since.
select tighten_binomial_siblings(array(select id from taxa));
