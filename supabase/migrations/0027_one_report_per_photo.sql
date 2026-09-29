-- A photograph belongs to one report.
--
-- POST /api/reports attached whatever storage paths the request named, once
-- each checked to exist, so the same uploaded photo could be attached to any
-- number of reports, and twice to one (security audit, 29 September 2026).
-- The route now refuses a path already in use and the schema refuses a
-- repeated one; this index is the guarantee under both.
--
-- Production had no report_photos rows when this was written, so nothing can
-- collide. Safe to re-run.

set local lock_timeout = '5s';

create unique index if not exists report_photos_storage_path_key
  on report_photos (storage_path);
