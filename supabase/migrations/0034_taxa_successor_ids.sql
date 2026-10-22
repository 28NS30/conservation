-- Keep TaiCOL's pointer from a retired name to the row that replaced it.
--
-- A TaiCOL refresh can leave a rating on a retired row while the row that
-- replaced it carries none. 0014 and 0023 hold such ratings with floors on the
-- name in use, found by RETIRED_TWINS_SQL (scripts/taxa-overrides.ts), which
-- paired a retired row with its replacement by matching scientific or Chinese
-- names. A rename matches neither. 鉛色水蛇 Enhydris plumbea (t0101462 and
-- t0105945, both rated 座標不開放) became 韋氏水蛇 Hypsiscopus wettsteini
-- (t0029845), which is only protected class III, and the snake's 29 records
-- went from hidden to 10 km. 0032 floors that row and 科勒氏鰍鮀 (t0101559) by
-- hand.
--
-- TaiCOL says which row replaced a retired one, in its new_taxon_id field:
-- 2,352 of the 29 September 2026 snapshot's deleted rows carry one. The import
-- threw it away; from here taxa keeps it, scripts/taicol-rows.ts fills it, and
-- RETIRED_TWINS_SQL pairs a retired row with its successor by id as well as by
-- name, so the preflight and the test suite catch the next rename before a
-- report is filed under it.
--
-- Run on production on 22 October 2026 with the snapshot's ids
-- (scripts/retired-twins.ts --from), the check finds 19 more pairs besides
-- the two 0032 holds, none with a record: plants, 15 of them orchids, whose
-- 輕度 rating (its own, or for one fern variety its parent's) stays on a name
-- TaiCOL has folded into a broader, unrated one (短葶雙葉蘭 Neottia
-- breviscapa into 大花雙葉蘭 Neottia wardii). No floor is added for them here.
-- A floor on the broader species blurs every record of it, and whether to is
-- the owner's decision; until it is made, the preflight and the retired-twin
-- test fail on a database that has the ids.
--
-- No foreign key, as for parent_taicol_id: a successor can come later in the
-- snapshot than the row that names it, and an import upserts in pages.
--
-- The column starts empty. Fill it for the rows already here from the snapshot
-- they were imported from, with scripts/taicol-successors-sql.ts; the next
-- import keeps it current. Nothing here or in that fill changes a record's
-- blur: taxon_precision() does not read the column, and the reblur trigger on
-- taxa (0012) fires only on the columns a rating is derived from.
--
-- Safe to re-run.

set local lock_timeout = '5s';

-- Only when it is missing. ALTER TABLE takes ACCESS EXCLUSIVE even when it
-- changes nothing, and every report insert reads taxa through the trigger
-- (0014), so a re-run would hold submissions for as long as it waited.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'taxa'
                    and column_name = 'new_taicol_id') then
    alter table taxa add column new_taicol_id text;
    comment on column taxa.new_taicol_id is
      'TaiCOL''s new_taxon_id: on a deleted row, the taicol_id of the row that replaced it. Read by RETIRED_TWINS_SQL in scripts/taxa-overrides.ts.';
  end if;
end $$;
