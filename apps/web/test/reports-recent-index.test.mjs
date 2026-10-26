/**
 * /reports' first page reads an index, not the whole table (migration 0035).
 *
 * The list opens on the newest public records, `order by observed_at desc,
 * id`, and nothing indexed that order: production read all 46,304 rows and
 * sorted them on disk to show 51, 141 ms a view (22 October 2026). The query
 * below is the list's own, with no filter chosen, as the public role runs it.
 *
 *   node --test test/reports-recent-index.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "./helpers.mjs";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");

describe("the newest-first index", () => {
  test("holds exactly the rows reports_public shows", async () => {
    const [ix] = await sql`
      select pg_get_expr(i.indpred, i.indrelid) as predicate,
             pg_get_indexdef(i.indexrelid) as def
        from pg_index i join pg_class c on c.oid = i.indexrelid
       where c.relname = 'reports_published_recent'`;
    assert.ok(ix, "reports_published_recent is missing; apply supabase/migrations/0035_reports_recent_index.sql");
    assert.match(ix.def, /\(observed_at DESC, id\)/);
    for (const term of ["status = 'published'", "location_precision <> 'suppressed'", "NOT is_test"])
      assert.ok(ix.predicate.includes(term), `the index's predicate lacks ${term}: ${ix.predicate}`);
  });

  test("serves the list's first page, as web_anon", async () => {
    // Pinned to the page's query: if it changes its order, this must too.
    const page = readFileSync(join(WEB, "app", "[locale]", "(site)", "reports", "(list)", "page.tsx"), "utf8");
    assert.match(page, /order by rp\.observed_at desc, rp\.id\s+limit \$\{PAGE_SIZE \+ 1\} offset \$\{offset\}/);

    // Sorting and whole-table scans are priced out of the plan, so it shows
    // whether the index can serve the query at all. Whether it is also the
    // cheapest way depends on the table's size: at CI's 650 rows a sort of
    // everything may well be, and at production's 46,000 it is not (the
    // migration's header has both plans).
    const plan = await sql.begin(async (tx) => {
      await tx`select set_config('role', 'web_anon', true),
                      set_config('enable_seqscan', 'off', true),
                      set_config('enable_sort', 'off', true)`;
      const rows = await tx`
        explain
        select rp.id, rp.category, rp.observed_at,
               st_y(rp.location_public::geometry) as lat,
               st_x(rp.location_public::geometry) as lng,
               rp.taxon_id, t.scientific_name, rp.is_invasive
          from reports_public rp
          left join taxa t on t.id = rp.taxon_id
         where (${null}::text[] is null or rp.category = any(${null}))
           and (not ${false}::boolean or rp.is_invasive)
           and (${null}::bigint is null or rp.taxon_id = ${null})
         order by rp.observed_at desc, rp.id
         limit 51 offset 0`;
      return rows.map((r) => r["QUERY PLAN"]).join("\n");
    });
    assert.match(plan, /Index Scan using reports_published_recent on reports/, plan);
    assert.doesNotMatch(plan, /Sort Key: reports\.observed_at/, plan);
  });
});
