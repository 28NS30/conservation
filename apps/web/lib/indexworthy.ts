/**
 * Whether a species page carries something a searcher could actually want, as
 * SQL. `t` is `taxa` and `s` is `species_report_stats`, left joined.
 *
 * The old rule was `reportCount === 0 -> noindex`, which left 458 of 66,201
 * pages indexable. That was the right instinct aimed at the wrong test: it
 * assumed the only thing worth indexing is our own data, when the page also
 * renders a name, an authority, a lineage, a habitat and up to four
 * conservation assessments from the TaiCOL checklist — none of which needs a
 * user to have reported anything.
 *
 * Counting facts does not work either: 48,273 species cleared "four or more",
 * and four generic fields repeated 48,273 times is exactly the mass of
 * near-identical thin pages the original comment was afraid of.
 *
 * So the test is whether the page says something DISTINGUISHING — a
 * conservation status, records of our own, endemism or invasiveness, or the
 * Chinese names people actually search by. A family or a genus page has a name
 * and a lineage and nothing else of its own; the species under it are the
 * pages worth finding. That admitted 29,468 of 136,680 taxa in production on
 * 26 October 2026.
 *
 * WHY IT IS SQL, AND WHY IN ONE PLACE. The species page asked this in
 * TypeScript and the sitemap asked a different question in SQL — "has a
 * report, or is protected or invasive" — under a hard `limit 5000`. They
 * disagreed by a factor of sixteen: 1,781 species in the sitemap against
 * 29,468 pages that said "index me", so most of what was indexable was never
 * offered to a crawler. The page and the sitemap now both splice this, and
 * test/crawl-and-ranks.test.mjs counts the one against the other.
 *
 * `nullif(…, '')` because the TypeScript it replaces tested truthiness, and an
 * empty string is not a status. A file of its own with no imports, so the test
 * can import the same string the site runs rather than a copy of it.
 *
 * Counts read `species_report_stats`, which is built on `reports_public`, so a
 * taxon whose coordinates are withheld counts no records here either.
 */
export const INDEXWORTHY = `(t.rank in ('Species', 'Subspecies') and (
  coalesce(s.report_count, 0) > 0
  or nullif(t.protected_status, '') is not null
  or nullif(t.iucn, '') is not null
  or nullif(t.redlist, '') is not null
  or nullif(t.cites, '') is not null
  or coalesce(t.is_endemic, false)
  or coalesce(t.is_invasive, false)
  or (nullif(t.common_name_zh, '') is not null and cardinality(t.alt_names_zh) > 0)
))`;
