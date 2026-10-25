-- Keep TaiCOL's pointer from a retired name to the row that replaced it, and
-- hold the ratings that pointer carries onto names TaiCOL folded together.
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
-- Followed through those ids, the check finds 19 more pairs besides the two
-- 0032 holds, all plants: a name rated 輕度 (its own rating, or for one fern
-- variety the species it is filed under) that TaiCOL has folded into a
-- broader, unrated one, as 短葶雙葉蘭 Neottia breviscapa, 塔塔加雙葉蘭 Neottia
-- tatakaensis and 奇萊雙葉蘭 went into 大花雙葉蘭 Neottia wardii. They fall on 14
-- names in use, floored here at 10 km, the level the retired names gave, as
-- 0023 held the plants the 29 September 2026 refresh would have left unrated.
-- A floor on the broader species blurs every record of it, which is why each
-- is held only until the owner decides otherwise. None has a record. The
-- reasons are also in scripts/taxa-overrides.csv, which the import and the
-- test fixture read.
--
-- No foreign key, as for parent_taicol_id: a successor can come later in the
-- snapshot than the row that names it, and an import upserts in pages.
--
-- The column starts empty. Fill it for the rows already here from the snapshot
-- they were imported from, with scripts/taicol-successors-sql.ts; the next
-- import keeps it current. Neither the column nor that fill changes a
-- record's blur: taxon_precision() does not read the column, and the reblur
-- trigger on taxa (0012) fires only on the columns a rating is derived from.
-- The floors below can, through their insert trigger (0014), and only by
-- tightening.
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

insert into taxon_precision_floors (taicol_id, min_precision, reason) values
  ('t0026690', 'coarse_10km',
   '長葉鱗毛蕨 Dryopteris sparsa. The deleted row for Dryopteris subtripinnata var. bunkikiyensis (t0124049) names this unrated row as its successor. It has no rating of its own and takes 輕度 from the species TaiCOL files it under, 肋毛蕨 Ctenitis subglandulosa (t0026636). Held at 10 km, the level the retired name gave, until the owner decides otherwise. No record.'),
  ('t0046110', 'coarse_10km',
   '鴨腱藤 Entada phaseoloides. The deleted rows for 榼藤子 Entada phaseoloides subsp. phaseoloides (t0101509) and 恆春鴨腱藤 Entada koshunensis (t0102672), both rated 輕度, name this unrated row as their successor. Held at 10 km, the level the retired names gave, until the owner decides otherwise. No record.'),
  ('t0049383', 'coarse_10km',
   '黃花線柱蘭 Zeuxine flava. The deleted row for 黃唇線柱蘭 Zeuxine sakagutii (t0049392), rated 輕度, names this unrated row as its successor. Held at 10 km, the level the retired name gave, until the owner decides otherwise. No record.'),
  ('t0053231', 'coarse_10km',
   'Cymbidium goeringii. The deleted rows for 台灣春蘭 Cymbidium formosanum (t0104587) and 朵朵香 Cymbidium formosanum var. formosanum (t0086763), both rated 輕度, name this unrated row as their successor. Held at 10 km, the level the retired names gave, until the owner decides otherwise. No record.'),
  ('t0053325', 'coarse_10km',
   '石斛 Dendrobium moniliforme. The deleted row for 琉球石斛 Dendrobium okinawense (t0053327), rated 輕度, names this unrated row as its successor. Held at 10 km, the level the retired name gave, until the owner decides otherwise. No record.'),
  ('t0053603', 'coarse_10km',
   '三藥細筆蘭 Erythrodes chinensis var. triantherae. The deleted rows for 無距細筆蘭 Erythrodes triantherae var. ecalcarata (t0086796) and 三葯細筆蘭 Erythrodes triantherae var. triantherae (t0086797), both rated 輕度, name this unrated row as their successor. Held at 10 km, the level the retired names gave, until the owner decides otherwise. No record.'),
  ('t0053618', 'coarse_10km',
   '紫芋蘭 Eulophia dentata. The deleted row for 瀨川氏芋蘭 Eulophia segawae (t0102099), rated 輕度, names this unrated row as its successor. Held at 10 km, the level the retired name gave, until the owner decides otherwise. No record.'),
  ('t0053848', 'coarse_10km',
   '高嶺斑葉蘭 Goodyera foliosa. The deleted row for 達悟斑葉蘭 Goodyera foliosa var. taoana (t0086842), rated 輕度, names this unrated row as its successor. Held at 10 km, the level the retired name gave, until the owner decides otherwise. No record.'),
  ('t0053852', 'coarse_10km',
   '斑葉蘭 Goodyera schlechtendaliana. The deleted row for 花格斑葉蘭 Goodyera kwangtungensis (t0102045), rated 輕度, names this unrated row as its successor. Held at 10 km, the level the retired name gave, until the owner decides otherwise. No record.'),
  ('t0053861', 'coarse_10km',
   '鳥喙斑葉蘭 Goodyera viridiflora. The deleted row for 淡紅歌綠懷蘭 Eucosia cordata (t0073908), rated 輕度, names this unrated row as its successor. Held at 10 km, the level the retired name gave, until the owner decides otherwise. No record.'),
  ('t0054556', 'coarse_10km',
   '大花雙葉蘭 Neottia wardii. The deleted rows for 短葶雙葉蘭 Neottia breviscapa (t0074916), 塔塔加雙葉蘭 Neottia tatakaensis (t0074920) and 奇萊雙葉蘭 Neottia fukuyamae var. chilaiensis (t0086909), all rated 輕度, name this unrated row as their successor. Held at 10 km, the level the retired names gave, until the owner decides otherwise. No record.'),
  ('t0057246', 'coarse_10km',
   '花柱蘭 Crepidium ophrydis. The deleted row for 壽卡小柱蘭 Dienia shuicae (t0073700), rated 輕度, names this unrated row as its successor. Held at 10 km, the level the retired name gave, until the owner decides otherwise. No record.'),
  ('t0057960', 'coarse_10km',
   '哥綠懷蘭 Goodyera seikoomontana. The deleted row for 歌綠懷蘭 Eucosia longirostrata (t0073910), rated 輕度, names this unrated row as its successor. Held at 10 km, the level the retired name gave, until the owner decides otherwise. No record.'),
  ('t0061063', 'coarse_10km',
   '薄葉蜘蛛抱蛋 Aspidistra attenuata. The deleted row for 霧社蜘蛛抱蛋 Aspidistra mushaensis (t0052655), rated 輕度, names this unrated row as its successor. Held at 10 km, the level the retired name gave, until the owner decides otherwise. No record.')
on conflict (taicol_id) do nothing;
