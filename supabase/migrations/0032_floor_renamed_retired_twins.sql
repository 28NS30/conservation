-- Two blur floors for retired TaiCOL names whose successors lost the rating.
--
-- 0023 added floors so that no TaiCOL refresh could loosen a blur: a retired
-- row's rating is held on the row that replaced it. It found the replacement
-- by matching names, and two renames slipped through (audit of 22 October
-- 2026):
--
--   * 鉛色水蛇 Enhydris plumbea (t0101462, t0105945) is rated 座標不開放, so its
--     records were hidden. TaiCOL now files the species as 韋氏水蛇
--     Hypsiscopus wettsteini (t0029845), which carries no sensitivity rating,
--     only protected class III. Its 29 records were therefore shown at 10 km,
--     a loosening the blur policy forbids. The floor holds them hidden, the
--     level they had under the retired name, until the owner decides
--     otherwise.
--   * A retired 中間鰍鮀 Gobiobotia intermedia row (t0029366, protected class
--     III) points to 科勒氏鰍鮀 Gobiobotia kolleri (t0101559), which is
--     unprotected. No record is on it today; the floor stops one ever losing
--     its 10 km blur by being moved there.
--
-- Applied to production on 22 October 2026 through the Management API, after
-- a dry run: 29 records tightened, 0 loosened, 0 of the snake's records left
-- in reports_public. The floor's insert trigger (0014) re-blurs the records.
--
-- The rows are also in scripts/taxa-overrides.csv, which the import and the
-- test fixture read. Safe to re-run.

set local lock_timeout = '5s';

insert into taxon_precision_floors (taicol_id, min_precision, reason) values
  ('t0029845', 'suppressed',
   '韋氏水蛇 Hypsiscopus wettsteini. TaiCOL renamed 鉛色水蛇 Enhydris plumbea (t0101462, t0105945, both rated 座標不開放) to this row, which carries no sensitivity rating, so its 29 records went from hidden to 10 km. Held hidden, the level the records had under the retired name, until the owner decides otherwise.'),
  ('t0101559', 'coarse_10km',
   '科勒氏鰍鮀 Gobiobotia kolleri. A retired 中間鰍鮀 Gobiobotia intermedia row (t0029366, protected class III) points here, and this row is unprotected, so a record moved onto it would lose its 10 km blur. Held at 10 km until the owner decides otherwise. No record.')
on conflict (taicol_id) do nothing;
