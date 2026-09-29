-- Whether a public record belongs to the invasive collection, as a column of
-- the public view.
--
-- The team asked for three "databases": roadkill, wildlife sightings (every
-- animal, with the invasive ones marked), and an invasive-species database that
-- holds only species tagged invasive. They overlap — a live 綠鬣蜥 is both a
-- wildlife sighting and an invasive record, a road-killed one is both roadkill
-- and invasive — so they are three filters over one table, not three tables.
-- Separate stores would mean writing a record twice and keeping a second copy
-- of the location-blur rules, and blur paths have already been missed twice
-- (0011, 0012). packages/shared COLLECTIONS says which filter is which; this
-- column is the one fact those filters need that `category` cannot give.
--
-- WHY A COLUMN AND NOT THE CATEGORY. Whether an animal is invasive is a fact
-- about its species, so it is read from the species every time a record is
-- shown, never typed by the reporter and never copied into the report. The old
-- way copied it: `recategorise` rewrote `category` when a moderator confirmed
-- a species, and only two of the four paths that set a species did so — the
-- classifier's auto-assign never did, and a TaiCOL refresh that changes
-- `taxa.is_invasive` re-derives nothing. Read here, a refresh reaches every
-- record the moment it lands.
--
-- THE DEFINITION is the team's default for "what counts as invasive" (plan §7
-- Q1-Q3, Q8):
--
--   * a record with a species is invasive when TaiCOL tags that species
--     invasive (`taxa.is_invasive`), it is an animal, and the name is one
--     TaiCOL still accepts. Naturalized and cultured species are not invasive;
--     plants are not in scope. A retired name is left out because TaiCOL keeps
--     its duplicates there — 多線南蜥 Mabuya multifasciata beside the accepted
--     多線真稜蜥 — and counting both would count one animal twice. No record
--     carries a retired invasive name today, and a report naming one is filed
--     with no species rather than under it (OFFERED, apps/web/lib/species.ts).
--   * whatever the record's category: a road-killed myna is in the invasive
--     collection (Q3), and so are cats and dogs, which TaiCOL tags (Q2).
--   * a record with no species is invasive only when it was filed as invasive
--     — someone on the invasive page who could not name the animal.
--
-- Birds introduced on Taiwan's main island but native to Kinmen or Matsu
-- (喜鵲, 鵲鴝, 黑領椋鳥, 大陸畫眉) stay out (Q8), and need nothing here to do so:
-- TaiCOL keeps one alien status for all three island groups, and theirs is
-- `native`. The note that says "臺灣: 引進種" is TaiCOL's alien_status_note,
-- which our import does not keep.
--
-- WHY THIS CANNOT LOOSEN ANY BLUR.
--
--   1. No grant. Postgres keeps a view's owner and privileges across
--      `create or replace`, so web_anon can read exactly what it could read
--      before, and still nothing on `reports`.
--   2. The same rows. FROM and WHERE are byte for byte those of 0010, so a
--      record withheld yesterday (座標不開放, or unpublished) is absent today.
--      The new column is a scalar expression and cannot add or remove a row.
--   3. Nothing new is read from `reports`. The column is computed from
--      `taxon_id` and `category`, which the view already publishes, and from
--      `taxa`, which web_anon can already read in full. It is a function of
--      public data.
--   4. No trigger changes. set_report_public_location fires on location,
--      taxon_id and precision_override; it never read the category, so
--      ending the category rewrite cannot move a blur either.
--
-- WHY `taxon_id in (select ...)` rather than a correlated lookup per row. The
-- subquery does not depend on the row, so Postgres runs it once per query and
-- probes a hash of about 210 ids. Measured over the 46,213 records of the
-- country-wide z6 map tile on the full local copy: reading the column costs
-- about 1 ms this way and about 25 ms as a per-row lookup into `taxa`, on a
-- query that takes 11 ms without it. It is only ever run by a query that reads
-- the column: species_report_stats and every existing read name their
-- columns, and a column nobody selects is never computed.
--
-- `create or replace`, never drop: species_report_stats selects from this view.
-- The first seventeen columns are 0010's, in 0010's order, and the new one is
-- appended, which is what `replace` requires. Safe to re-run.

-- Give up rather than queue. Replacing a view takes an exclusive lock on the
-- view alone, which waits for the reads in flight; a lock not free within five
-- seconds fails the migration instead of stalling every request behind it.
-- `local` scopes it to scripts/migrate.ts's one transaction per file; under a
-- plain `psql -f` Postgres warns and ignores it, as it does for 0014.
set local lock_timeout = '5s';

create or replace view reports_public as
  select id,
         category,
         geom_3857,
         location_public,
         location_precision,
         is_obscured,
         observed_at,
         notes,
         taxon_id,
         taxon_source,
         verbatim_name,
         ai_confidence,
         source,
         license,
         rights_holder,
         created_at,
         case when location_precision = 'exact' then location_accuracy_m end
           as location_accuracy_m,
         case
           when taxon_id is not null then
             taxon_id in (select t.id
                            from public.taxa t
                           where t.is_invasive
                             and t.kingdom = 'Animalia'
                             and t.taxon_status = 'accepted')
           else category = 'invasive'
         end as is_invasive
    from reports
   where status = 'published'
     and location_precision <> 'suppressed';

comment on column reports_public.is_invasive is
  'In the invasive collection: the species is an animal TaiCOL tags invasive, under a name TaiCOL accepts, or the record has no species and was filed as invasive. Read from taxa at query time; never stored on the report.';
