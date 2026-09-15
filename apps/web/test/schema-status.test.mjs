import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sql, BASE_URL } from "./helpers.mjs";

/**
 * The guard that says whether this deployment can accept a report.
 *
 * The first version of it held its queries in a module-level array of tagged
 * templates, which is the trap the second test below describes: it would have
 * answered once per process and then repeated itself, so after someone applied
 * a missing migration the endpoint would have kept reporting it missing and
 * sent them hunting a problem they had already fixed.
 */
after(() => sql.end());

describe("schema status", () => {
  test("the endpoint reports this database as current", async () => {
    const body = await (await fetch(`${BASE_URL}/api/health`)).json();
    assert.equal(
      body.schemaCurrent,
      true,
      `missing: ${(body.schemaMissing ?? []).join(", ")}`,
    );
  });

  test("a reused postgres.js query answers from memory", async () => {
    // Not a test of our code — a test of the behaviour our code has to avoid,
    // recorded because it is silent, surprising, and the reason for the shape
    // of lib/schemaStatus.ts.
    await sql`drop table if exists schema_status_probe`;
    await sql`create table schema_status_probe (n int)`;
    try {
      const held = sql`select count(*)::int as n from schema_status_probe`;
      assert.equal((await held)[0].n, 0);
      await sql`insert into schema_status_probe values (1)`;
      assert.equal(
        (await held)[0].n,
        0,
        "awaiting a held query again must resolve the first result",
      );
      const [fresh] = await sql`select count(*)::int as n from schema_status_probe`;
      assert.equal(fresh.n, 1, "a query built per call sees the new row");
    } finally {
      await sql`drop table schema_status_probe`;
    }
  });

  test("the checks are built per call, not held at module scope", () => {
    const src = readFileSync(
      new URL("../lib/schemaStatus.ts", import.meta.url),
      "utf8",
    );
    // The checks are SQL strings run through sql.unsafe() inside the function.
    // A tagged template at module scope is exactly the bug above.
    assert.match(src, /export async function schemaStatus\(/);
    assert.ok(
      !/^const [A-Z_]+ = sql`/m.test(src),
      "no module-level tagged template may hold a check",
    );
  });
});
