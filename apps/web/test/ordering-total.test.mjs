/**
 * A list that pages must be in a total order.
 *
 * The records list sorted by date alone. The TaiRON import ends on 2017-12-31
 * and hundreds of records share each date, and Postgres returns rows that tie
 * in whatever order its plan produces, which need not match between two
 * LIMIT/OFFSET queries. Page 1 showed different records on each load, pages 1
 * and 2 overlapped, and some records could not be reached by paging at all.
 * lib/species.ts's directory already ends its ORDER BY with t.id for the same
 * reason; this holds every paged query to it.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql } from "./helpers.mjs";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

describe("paged queries", () => {
  test("every ORDER BY before an OFFSET ends with a unique id", () => {
    const offenders = [];
    let found = 0;
    for (const dir of ["app", "lib"])
      for (const file of sources(join(WEB, dir))) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/order by([\s\S]*?)limit [^`]*?offset/gi)) {
          found++;
          // The last ORDER BY key, with comments and whitespace removed.
          const keys = m[1].replace(/--.*$/gm, "").split(",").map((k) => k.trim()).filter(Boolean);
          const last = keys.at(-1) ?? "";
          if (!/^(?:\w+\.)?id(?:\s+(?:asc|desc))?$/i.test(last))
            offenders.push(`${file.slice(WEB.length)}: ends with "${last}"`);
        }
      }
    assert.ok(found >= 2, `found only ${found} paged queries; the pattern no longer matches the code`);
    assert.deepEqual(offenders, []);
  });

  test("the records list's two pages share nothing, on data full of ties", async () => {
    // The list's own ordering over the public view, as the page runs it.
    const page = (offset) => sql`
      select rp.id from reports_public rp
       order by rp.observed_at desc, rp.id
       limit 50 offset ${offset}`;
    const [{ ties }] = await sql`
      select count(*)::int as ties from (
        select observed_at from reports_public group by 1 having count(*) > 50) x`;
    if (ties === 0) return; // CI's fixture has too few records to tie across a page.
    const a = (await page(0)).map((r) => r.id);
    const b = (await page(50)).map((r) => r.id);
    const again = (await page(0)).map((r) => r.id);
    assert.deepEqual(again, a, "page 1 changed between two loads");
    assert.equal(a.filter((id) => b.includes(id)).length, 0, "pages 1 and 2 overlap");
  });
});
