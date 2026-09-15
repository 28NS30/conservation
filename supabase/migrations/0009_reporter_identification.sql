-- Let the reporter name the species, and let them say they cannot.
--
-- Until now identification was entirely post-hoc: a report arrived with no
-- taxon, the classifier looked at the photograph, and `taxon_source` recorded
-- who decided ('ai', 'user' on confirmation, 'expert' from a moderator,
-- 'imported' from GBIF). The person who actually saw the animal had no way to
-- say what it was.
--
-- Two changes, both to `taxon_source`.
--
-- 'user' now also covers an identification made at submission time. It is the
-- same claim as confirming the classifier's guess — the reporter's own word —
-- and the Darwin Core export already labels it "Unverified — reporter's own
-- identification", which stays exactly right.
--
-- 'unknown' is new, and it is the one the roadkill case needs. A flattened
-- carcass often cannot be named by anyone, and the team asked for it to be
-- submittable as uncertain rather than guessed at. Without this value, a report
-- nobody could identify is indistinguishable from one nobody has looked at yet:
-- both are `taxon_id is null, taxon_source is null`. With it, the reporter's "I
-- do not know" is recorded as a judgement, which is what it is.
--
-- `taxon_source = 'unknown'` always accompanies `taxon_id is null`; the
-- constraint below says so rather than leaving it to convention.
alter table reports drop constraint if exists reports_taxon_source_check;

alter table reports
  add constraint reports_taxon_source_check
  check (taxon_source in ('ai', 'user', 'expert', 'imported', 'unknown'));

alter table reports drop constraint if exists reports_unknown_has_no_taxon;

alter table reports
  add constraint reports_unknown_has_no_taxon
  check (taxon_source is distinct from 'unknown' or taxon_id is null);
