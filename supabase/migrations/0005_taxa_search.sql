-- Search indexes for the species directory.
--
-- 66k taxa is small enough that a sequential scan is survivable, but the
-- autocomplete endpoint runs on every keystroke, so it needs to be indexed.

create extension if not exists pg_trgm;

-- Trigram matching handles Latin typos and partial genus/species input well.
create index if not exists taxa_sci_trgm
  on taxa using gin (scientific_name gin_trgm_ops);

-- NOTE: this index does NOT help typical Chinese queries, and that is expected.
-- pg_trgm needs >=3 characters to form a trigram, but most Chinese species names
-- are searched with 2 characters (石虎, 山羌), which yields no trigrams and falls
-- back to a scan. Measured: a full parallel scan filtering 125k taxa on a 2-char
-- substring runs in ~18 ms, which is fine for debounced autocomplete, so this is
-- deliberately not solved with a heavier extension (pg_bigm is unavailable here;
-- pgroonga would be a large dependency for an 18 ms problem).
-- The index is kept because it does help longer Chinese queries and romanised input.
create index if not exists taxa_zh_trgm
  on taxa using gin (common_name_zh gin_trgm_ops);

-- alt_names_zh holds synonyms and regional names — 石虎 is an alternative name
-- for 豹貓, so searching the common name alone misses the species most people
-- actually mean.
create index if not exists taxa_alt_names_gin
  on taxa using gin (alt_names_zh);

-- The directory ranks species that actually have records first, so this
-- supports both the ranking subquery and the "has records" filter.
create index if not exists reports_taxon_published
  on reports (taxon_id)
  where status = 'published' and location_precision <> 'suppressed';

/**
 * Per-species record summary for the public directory.
 *
 * Reads reports_public rather than reports: a taxon rated 座標不開放 must not
 * leak its record count here, and building this on the base table would do
 * exactly that.
 */
create or replace view species_report_stats as
  select rp.taxon_id            as taxon_id,
         count(*)::int          as report_count,
         min(rp.observed_at)    as first_seen,
         max(rp.observed_at)    as last_seen
    from reports_public rp
   where rp.taxon_id is not null
   group by rp.taxon_id;

grant select on species_report_stats to web_anon;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on species_report_stats to anon, authenticated;
  end if;
end $$;
