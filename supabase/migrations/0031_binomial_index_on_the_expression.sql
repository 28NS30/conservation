-- Index the binomial on its expression, not on binomial_of().
--
-- 0028 indexed binomial_of(scientific_name) so that binomial_precision() finds
-- a taxon's siblings without reading all of taxa. In production the record
-- page's suggestions check still took 1.1 to 1.4 s for each of the first two
-- public reports, and a first view could pass the 8-second limit on public
-- queries and answer 500 (30 September 2026). The index was used or not
-- depending on which role first planned a query on taxa in that database
-- session:
--
--   * Postgres inlines a SQL function such as binomial_of() only for a user
--     who may execute it. That applies to an index's expression too, and the
--     result is cached with the table's other metadata for the rest of the
--     session.
--   * web_anon may not execute binomial_of() (0024). When a public read, such
--     as the record page's own row, plans a query on taxa first, the index's
--     expression is cached as the un-inlined binomial_of(scientific_name).
--   * binomial_precision() then runs as the function owner, inlines
--     binomial_of() to its body, and finds no index with that expression: a
--     full scan of taxa per candidate, 61,283 buffers for one record page.
--
-- Loaded by the owner first, the same query took 16 ms. The site's pooled
-- connections serve both roles, so which came first was chance.
--
-- An index on the expression itself, which calls only built-in functions
-- everyone may execute, is the same to every role. binomial_of() still
-- inlines to exactly this expression where it is called by a role that may
-- execute it, as it is inside binomial_precision(), so every lookup matches.
-- apps/web/test/binomial-index.test.mjs opens a session as web_anon first and
-- checks the plan.
--
-- The index keeps its name. Safe to re-run.

set local lock_timeout = '5s';

drop index if exists taxa_binomial_idx;
create index taxa_binomial_idx on taxa
  ((lower(split_part(scientific_name, ' ', 1) || ' ' || split_part(scientific_name, ' ', 2))));

analyze taxa;
