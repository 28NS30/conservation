/**
 * The binomial index serves every lookup, whichever role touched taxa first
 * (migration 0031).
 *
 * 0028's index on binomial_of(scientific_name) went unused in any database
 * session where web_anon had planned a query on taxa first: Postgres inlines a
 * SQL function only for a role that may execute it, index expressions
 * included, and web_anon may not execute binomial_of(). The record page's
 * suggestions check then read all of taxa for each candidate, 1.1 to 1.4 s in
 * production, and a cold first view answered 500. Each test here opens its own
 * connection, so what the session caches is what the test did.
 *
 *   node --test test/binomial-index.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { sql } from "./helpers.mjs";

after(() => sql.end());

/** A single fresh database session, ended after `fn`. */
async function freshSession(fn) {
  const one = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    return await one.begin(async (tx) => fn(tx));
  } finally {
    await one.end();
  }
}

const planOf = async (tx) =>
  (await tx`explain select 1 from taxa where binomial_of(scientific_name) = 'paguma larvata'`)
    .map((r) => r["QUERY PLAN"])
    .join("\n");

describe("the binomial index", () => {
  test("web_anon may not execute binomial_of(), which is what made the order matter", async () => {
    const [{ ok }] = await sql`
      select has_function_privilege('web_anon', 'public.binomial_of(text)', 'execute') as ok`;
    assert.equal(ok, false);
  });

  test("is on the expression, calling nothing the site defines", async () => {
    const [idx] = await sql`select indexdef from pg_indexes where indexname = 'taxa_binomial_idx'`;
    assert.ok(idx, "taxa_binomial_idx is missing");
    assert.doesNotMatch(idx.indexdef, /binomial_of/);
    assert.match(idx.indexdef, /lower\(\(\(split_part\(scientific_name, ' '::text, 1\) \|\| ' '::text\) \|\| split_part\(scientific_name, ' '::text, 2\)\)\)/);
  });

  test("serves a lookup in a session where web_anon planned a query on taxa first", async () => {
    const plan = await freshSession(async (tx) => {
      await tx`set local role web_anon`;
      await tx`select count(*) from taxa where id = 1`;
      await tx`reset role`;
      // CI's fixture is small enough that a scan wins on cost; priced out,
      // the plan shows whether the index can serve the lookup at all.
      await tx`set local enable_seqscan = off`;
      return planOf(tx);
    });
    assert.match(plan, /taxa_binomial_idx/);
  });

  test("and in one where the owner did", async () => {
    const plan = await freshSession(async (tx) => {
      await tx`set local enable_seqscan = off`;
      return planOf(tx);
    });
    assert.match(plan, /taxa_binomial_idx/);
  });
});

describe("the record page", () => {
  test("renders without the suggestions, the species card or the counts if a read fails", () => {
    const page = readFileSync(join(import.meta.dirname, "..", "app", "[locale]", "(site)", "reports", "[id]", "page.tsx"), "utf8");
    assert.match(page, /optional\("the model's suggestions", readSuggestions, \[\] as Suggestion\[\]\)/);
    assert.match(page, /optional\("the species card", \(\) => getSpecies\(taxonId\), null\)/);
    assert.match(page, /optional\("the monthly counts", \(\) => monthlyCounts\(taxonId\), null\)/);
  });
});
