-- Records on names that do not apply in Taiwan, moved to the names that do.
--
-- The team's request 13 ("make sure the species classifications are correct").
-- Four sets of TaiRON's records were filed, through GBIF's re-filing, under a
-- name that is not the Taiwanese animal. Each was checked against TaiCOL and
-- the protected-species list by two researchers (roadmap, "species fixes"):
--
--   石虎     22 records on 豹貓 Prionailurus bengalensis, the species row, which
--            TaiCOL rates class II. Every wild leopard cat in Taiwan is the
--            subspecies 石虎 P. b. euptilurus (t0105762), which the law lists as
--            class I. The species row keeps its class II; it is right for the
--            species as a whole, and it is still offered to reporters.
--   臺灣蛇蜥 30 records on 哈特氏蛇蜥 Dopasia harti, a Fujian lizard, which
--            TaiCOL now keeps outside Taiwan. The Taiwan animal is D.
--            formosensis (t0028707), unrated by TaiCOL but protected by law under
--            its old name; 0014 gave it a 10 km floor so this move cannot
--            publish it more exactly. That floor had to exist first.
--   Sesarmops impressus, 17 records, a crab not found in Taiwan: TaiRON's
--            records are 帝王仿相手蟹 S. imperator (t0038839).
--   Eothenomys melanogaster, 3 records, a vole of mainland China: Taiwan's is
--            E. colurnus (t0105743).
--
-- Not moved: 日本樹蛙 Buergeria japonica (75) is 周氏樹蛙 or 太田樹蛙 depending
-- on where each was found, and Upupa epops epops (13) is probably 戴勝 U. e.
-- saturata. A biologist decides those; the species page says so meanwhile.
--
-- TIGHTENING ONLY. Changing taxon_id re-fires the trigger, which recomputes the
-- blur from the new taxon. Each UPDATE also stamps the record's current blur as
-- its override, so whatever the new taxon's rule says, no record comes out less
-- blurred than it went in. A record that is exact now is left unstamped: an
-- 'exact' override adds nothing, and a stamp is read by every later correction
-- as a deliberate decision (keepDeliberateOverride, lib/report/precision.ts).
-- On the local copy of production: 石虎 and 臺灣蛇蜥 stay at 10 km, the crab and
-- the vole stay exact, and nothing else changes.
--
-- Keyed by TaiCOL id, because taxa.id is renumbered by a fresh import. The join
-- to both rows means a database that lacks either one moves nothing, rather
-- than un-identifying the records. Only TaiRON's imported records move: they
-- are what was checked. Idempotent: a second run finds nothing left to move.

set local lock_timeout = '5s';

update reports r
   set taxon_id = dst.id,
       precision_override = case
         when r.location_precision = 'exact' then r.precision_override
         else stricter_precision(r.precision_override, r.location_precision)
       end
  from taxa src, taxa dst,
       (values ('t0032116', 't0105762'),   -- 豹貓 → 石虎
               ('t0124472', 't0028707'),   -- Dopasia harti → 臺灣蛇蜥
               ('t0105665', 't0038839'),   -- Sesarmops impressus → 帝王仿相手蟹
               ('t0062784', 't0105743'))   -- Eothenomys melanogaster → E. colurnus
         as m(from_taicol, to_taicol)
 where src.taicol_id = m.from_taicol
   and dst.taicol_id = m.to_taicol
   and r.taxon_id = src.id
   and r.source = 'gbif';
