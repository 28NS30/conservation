-- TaiRON's 13 hoopoe records, moved from Upupa epops epops to the species 戴勝.
--
-- GBIF filed them under the nominate subspecies, which lives from Europe to
-- Central Asia and which TaiCOL does not record in Taiwan (t0102553 has no
-- Chinese name, the only recorded taxon without one). 0022 left them for a
-- biologist because the subspecies is uncertain: probably 戴勝 U. e. saturata.
-- The species is certain whichever subspecies they are, so they move to it
-- (t0096620) and the subspecies question stays open without blocking the name.
-- 12 of the 13 are on Kinmen and 1 is on the main island.
--
-- BLUR-NEUTRAL, checked on production on 25 October 2026: both rows are
-- unprotected, unrated by TaiCOL and unfloored, both rules give 'exact', and all
-- 13 records are exact with no override. The UPDATE still stamps a blurred
-- record's blur as its override, as 0022 does, so that if any of this has
-- changed by the time it runs, no record comes out less blurred than it went in.
--
-- Keyed by TaiCOL id; a database lacking either row moves nothing. Only
-- TaiRON's imported records move, and none a person has identified.
-- Idempotent.

set local lock_timeout = '5s';

update reports r
   set taxon_id = dst.id,
       precision_override = case
         when r.location_precision = 'exact' then r.precision_override
         else stricter_precision(r.precision_override, r.location_precision)
       end
  from taxa src, taxa dst
 where src.taicol_id = 't0102553'   -- Upupa epops epops
   and dst.taicol_id = 't0096620'   -- 戴勝 Upupa epops
   and r.taxon_id = src.id
   and r.source = 'gbif'
   and coalesce(r.taxon_source, 'imported') not in ('expert', 'user');
