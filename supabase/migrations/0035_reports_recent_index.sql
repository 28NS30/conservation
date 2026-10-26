-- Index the public records newest first, for /reports.
--
-- /reports opens on the newest 50 public records, `order by observed_at desc,
-- id`, from reports_public: the published, unsuppressed, non-test rows of
-- reports (0018). Nothing indexed that order, so every view of the list's
-- first page read the whole table and sorted it to keep 51 rows. In
-- production on 22 October 2026 that was a sequential scan of 46,304 rows
-- and a sort that spilled to disk (external merge, 3.9 MB): 141 ms of
-- database time for one page, and the list renders per request, because it
-- reads its query string.
--
-- The index holds exactly the rows the view shows, in the list's order, so
-- the first page is the first 51 entries of it. Its predicate is the view's
-- own, so the planner can prove the view's rows are all in it, for web_anon
-- as for the owner. Locally the first page went from a sort of every
-- row (80 ms) to an index scan that stops at 51 (2 ms). A list filtered by
-- collection or species walks it in order and filters, or uses
-- reports_category_time and reports_taxon_published as before, whichever the
-- planner finds cheaper; so do the collection pages' newest records, which
-- are read in the same order (locally the roadkill page's takes this index).
--
-- Here it is built in the migration's transaction, which blocks writes to
-- reports for as long as the build takes (well under a second for 46,000
-- rows; lock_timeout gives up rather than queue behind a long transaction,
-- and every write behind it). Production builds
-- it without blocking instead, outside a transaction, by hand:
--
--   create index concurrently if not exists reports_published_recent
--     on reports (observed_at desc, id)
--     where status = 'published' and location_precision <> 'suppressed' and not is_test;
--
-- and then records this file in the migration ledger. If a concurrent build
-- fails it leaves an invalid index of this name behind, which `if not
-- exists` would then skip: drop it (`drop index concurrently
-- reports_published_recent`) and build it again.
--
-- Safe to re-run.

set local lock_timeout = '5s';

create index if not exists reports_published_recent
  on reports (observed_at desc, id)
  where status = 'published' and location_precision <> 'suppressed' and not is_test;
