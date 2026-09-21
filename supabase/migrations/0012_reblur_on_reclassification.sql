-- A taxon's rating can change after its records are published, and nothing
-- noticed.
--
-- `set_report_public_location()` fires on `reports.location`, `taxon_id` and
-- `precision_override` (0003:92). It does not fire — nothing does — when
-- `taxa.sensitivity` or `taxa.protected_status` changes, because there is no
-- trigger on `taxa` at all. So the blur every record carries is the answer
-- TaiCOL gave on the day that record was written.
--
-- TaiCOL revises. When a species is newly rated 輕度, or newly listed as
-- protected, every record of it already in the database keeps sitting at its
-- exact coordinate, on a public map, indefinitely. The next import updates the
-- rating and publishes nothing about the records it should have moved. This is
-- the same failure as 0011's — a location that is public because nobody
-- recomputed it — reached by a different route, and the reason it has not bitten
-- is that TaiCOL has been imported once.
--
-- TIGHTENING ONLY, and that is the whole design.
--
-- Re-deriving on every rating change would also run the other way: a species
-- whose sensitivity is WITHDRAWN would have every one of its records snap back
-- to full precision, as a side effect of somebody running an import. Publishing
-- a location that was withheld is a decision, and a decision is not something an
-- overnight job gets to make. So the comparison below is one-directional: if the
-- new policy is stricter than the old one, re-derive; otherwise leave the
-- records exactly as they are and let a person loosen them deliberately.
--
-- Cost: the UPDATE only runs for a taxon whose rating genuinely became
-- stricter, which is rare, and touches only that taxon's own records. A routine
-- re-import that changes nothing does nothing. `obscure_point` is deterministic
-- per record id, so a record does not wander between runs.
create or replace function reblur_reports_for_taxon() returns trigger
language plpgsql set search_path = public as $$
declare
  was text;
  now_ text;
begin
  was  := precision_from_taxon(old.sensitivity, old.protected_status);
  now_ := precision_from_taxon(new.sensitivity, new.protected_status);

  -- Strictly stricter. Equal means nothing to do; looser is a publication
  -- decision this trigger refuses to make.
  if precision_rank(now_) > precision_rank(was) then
    -- Assigning `location` to itself re-fires the BEFORE trigger on `reports`,
    -- which is what recomputes location_precision and location_public. Same
    -- mechanism as 0011's backfill.
    update reports set location = location where taxon_id = new.id;
  end if;

  return null;
end $$;

drop trigger if exists taxa_reblur_reports on taxa;

create trigger taxa_reblur_reports
  after update of sensitivity, protected_status on taxa
  for each row execute function reblur_reports_for_taxon();

-- No backfill here. Every record's precision already matches the rating its
-- taxon carries today, because 0011 re-derived the untaxoned ones and the
-- reports trigger has derived the rest from `taxa` as it stood at write time.
-- This migration is about what happens NEXT time a rating moves.
