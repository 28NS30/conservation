/**
 * The home page's block for this month (lib/stats.ts, monthRoadkill): the
 * animals most often found dead on the roads in this calendar month, in every
 * year of records.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, BASE_URL, requireServer } from "./helpers.mjs";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const STATS = readFileSync(join(WEB, "lib", "stats.ts"), "utf8");
const query = STATS.slice(STATS.indexOf("export const monthRoadkill"), STATS.indexOf("export type LedgerRow"));

/** The figure's own query, for a month, as the page asks it. */
const top = (month, limit = 5) => sql`
  select t.id, t.scientific_name, count(*)::int as n
    from reports_public rp
    join taxa t on t.id = rp.taxon_id
   where rp.category = 'roadkill'
     and rp.location_precision = 'exact'
     and extract(month from rp.observed_at at time zone 'Asia/Taipei') = ${month}
     and t.common_name_zh is not null
   group by t.id
   order by n desc, t.id
   limit ${limit}`;

describe("this month on the roads", () => {
  test("counts exact roadkill records in Taiwan's month, and nothing blurred", () => {
    assert.match(query, /rp\.category = 'roadkill'/);
    assert.match(query, /rp\.location_precision = 'exact'/);
    assert.match(query, /extract\(month from rp\.observed_at at time zone 'Asia\/Taipei'\) = \$\{month\}/);
    assert.match(query, /siteFigure\("monthRoadkill"/);
  });

  test("in any month, names no species whose rule blurs it", async () => {
    for (let month = 1; month <= 12; month++) {
      for (const sp of await top(month)) {
        const [{ p }] = await sql`select taxon_precision(${sp.id}) as p`;
        assert.equal(p, "exact", `month ${month}: ${sp.scientific_name} is ${p}`);
      }
    }
  });

  test("the home page lists this month's, or says nothing in a month with none", async (t) => {
    if (!(await requireServer(t))) return;
    const month = Number(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei", month: "numeric" }));
    const expected = await top(month);
    const html = await (await fetch(`${BASE_URL}/en`)).text();
    if (expected.length === 0) {
      assert.doesNotMatch(html, /id="month-title"/);
      return;
    }
    assert.match(html, /id="month-title"/);
    const first = `/en/species/${expected[0].id}-`;
    assert.ok(html.includes(first), `the list starts with ${expected[0].scientific_name}`);
  });
});
