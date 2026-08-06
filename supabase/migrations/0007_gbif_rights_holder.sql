-- Backfill the rights holder on imported records.
--
-- Every seeded record carries license = CC BY 4.0, which *requires* attribution
-- by name. But rights_holder was null on all 46,402 of them, so /attribution —
-- a page that exists to satisfy that licence condition — rendered "未標示"
-- (unspecified) next to the whole corpus. The prose above the table named the
-- source correctly, so this was a presentation failure rather than a missing
-- permission, but the table is the machine-readable half of the claim and it
-- was saying the opposite of the paragraph above it.
--
-- The cause: GBIF's occurrence search returns rightsHolder per *occurrence*, and
-- this dataset does not populate it. Attribution for GBIF-mediated data is made
-- at the dataset level, by the publishing organisation:
--
--   dataset db09684b-0fd1-431e-b5fa-4c1532fbdb14
--     "The Taiwan Roadkill Observation Network Data Set"
--   published by 7c07cec1-2925-443c-81f1-333e4187bdea
--     Taiwan Biodiversity Research Institute (臺灣生物多樣性研究所)
--     originator contact: Te-En Lin
--
-- Scoped to the dataset key rather than applied to every gbif row, so importing
-- a second dataset later cannot silently inherit this one's attribution.
-- import-gbif.ts now resolves the publishing organisation at import time, so new
-- rows arrive already attributed and this backfill stays a one-off.

update reports
   set rights_holder = 'Taiwan Biodiversity Research Institute (臺灣生物多樣性研究所)'
 where source = 'gbif'
   and rights_holder is null
   and source_id like 'db09684b-0fd1-431e-b5fa-4c1532fbdb14:%';
