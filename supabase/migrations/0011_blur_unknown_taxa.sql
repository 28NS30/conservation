-- An unidentified record is not a record of something harmless.
--
-- `set_report_public_location()` asks `precision_from_taxon(sensitivity,
-- protected_status)` how much to blur. Both values come from the row's taxon —
-- and when there is no taxon, the trigger never runs that lookup, so both stay
-- NULL, every `when` in the function falls through, and the answer is 'exact'.
--
-- That reads "no sensitivity rating" as "not sensitive". They are not the same
-- claim. The first is an absence of knowledge; the second is knowledge. For a
-- record nobody has identified, the honest answer is that we do not know what
-- is on that map pin, and a location we cannot vouch for should not be
-- published to the metre.
--
-- This is not hypothetical. The GBIF import matches TaiRON's published names
-- against TaiCOL's *accepted* names (scripts/import-gbif.ts), so rows carrying a
-- superseded synonym matched nothing and arrived with taxon_id null:
--
--   Xenochrophis piscator   445 rows   now Fowlea flavipunctatus, 草花蛇,  protected III, 敏感度 輕度
--   Herpestes urva           97 rows   now Urva urva,            棕簑貓,  protected III, 敏感度 輕度
--
-- Both are rated 輕度, so this project's own policy is a 10 km blur. Both were
-- published at their true coordinates instead, with `verbatim_name` exposed
-- beside them through `reports_public` — a named protected animal at an exact
-- spot, which is the thing /about tells readers we do not do. In total 7,336
-- published rows had no taxon and every one of them was 'exact'; the other
-- 6,794 are not known to be safe, they are simply unexamined.
--
-- The fix is the one branch the trigger was missing, plus a backfill of the rows
-- already published under the old behaviour. It can only ever hide a record,
-- never reveal one.
--
-- Resolving those synonyms to real taxa is a separate and larger job (see
-- docs/redesign/briefs/W0c.md). It is the durable fix and it will move some of
-- these records back to 'exact' once their real taxon is known. This is the
-- stop-loss that does not wait for it.
create or replace function set_report_public_location() returns trigger
language plpgsql set search_path = public as $$
declare
  sens text; prot text; p_taxon text; p text;
begin
  if new.taxon_id is not null then
    select sensitivity, protected_status into sens, prot from public.taxa where id = new.taxon_id;
    p_taxon := precision_from_taxon(sens, prot);
  else
    -- No taxon means no sensitivity rating, which is not the same as "not
    -- sensitive". Matches UNIDENTIFIED_PRECISION on the submission path
    -- (packages/shared/src/index.ts), so a report blurred while it waits for
    -- identification is not un-blurred by arriving through a different door.
    p_taxon := 'coarse_10km';
  end if;

  -- Most conservative of (taxon policy, explicit override) wins. An override can
  -- never reveal a location that the taxon's own policy would have hidden.
  if precision_rank(coalesce(new.precision_override, 'exact')) > precision_rank(p_taxon) then
    p := new.precision_override;
  else
    p := p_taxon;
  end if;

  new.location_precision := p;
  new.location_public := case
    when p = 'exact' then new.location
    else obscure_point(new.location, new.id, precision_cell_deg(p))
  end;
  return new;
end $$;

-- Re-derive the rows that were written under the old behaviour. The trigger is
-- `before insert or update of location, taxon_id, precision_override`, so
-- assigning `location` to itself re-fires it. `obscure_point` is deterministic
-- per record id, so this is idempotent: a record does not wander between runs.
update reports set location = location where taxon_id is null;
