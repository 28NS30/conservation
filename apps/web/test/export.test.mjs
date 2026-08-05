/**
 * What the Darwin Core Archive export is allowed to contain.
 *
 * The stakes are not internal. This archive gets uploaded to GBIF under our
 * name, and GBIF deduplicates on occurrenceID across the whole network. Export
 * the ~46k TaiRON records we *imported* from GBIF and we would republish 路殺社's
 * decade of fieldwork as our own — duplicating their occurrences and
 * misattributing the publisher. That is not a bug you can quietly fix later; it
 * pollutes a shared scientific commons and it is visibly bad faith.
 *
 * So the filter in scripts/export-dwca.ts is pinned here.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql, inRollback, insertReport, taxonWhere } from "./helpers.mjs";

after(() => sql.end());

/** The export's row query, kept in step with scripts/export-dwca.ts. */
const exportable = (tx, includeUnidentified = false) => tx`
  select r.id::text, r.source, r.location_precision
    from reports_public r
   where r.source = 'user'
     and r.location_precision <> 'suppressed'
     and (${includeUnidentified} or r.taxon_id is not null)`;

describe("Darwin Core export", () => {
  test("never includes a record imported from GBIF", async () => {
    const rows = await exportable(sql, true);
    const foreign = rows.filter((r) => r.source !== "user");
    assert.equal(
      foreign.length,
      0,
      "the export must contain only records this project originated",
    );
  });

  test("the seeded corpus is entirely excluded", async () => {
    // Sanity check that the filter is doing real work rather than passing
    // because the table happens to be empty of imported rows.
    const [{ imported }] = await sql`
      select count(*)::int as imported from reports where source <> 'user'`;
    assert.ok(imported > 0, "expected the GBIF seed to be present");
    const rows = await exportable(sql, true);
    assert.ok(
      rows.every((r) => r.source === "user"),
      `${imported} imported records exist and none may appear in the export`,
    );
  });

  test("excludes suppressed records entirely", async () => {
    await inRollback(async (tx) => {
      const taxonId = await taxonWhere("sensitivity = '座標不開放' and is_in_taiwan");
      const r = await insertReport(tx, { taxonId });
      assert.equal(r.location_precision, "suppressed", "fixture precondition");
      await tx`update reports set source = 'user' where id = ${r.id}::uuid`;

      const rows = await exportable(tx, true);
      assert.ok(
        !rows.some((x) => x.id === r.id),
        "a suppressed record must not be published, at any coordinate",
      );
    });
  });

  test("includes a user record, and obscured ones are not silently dropped", async () => {
    // Obscured records are still scientifically useful at their stated
    // uncertainty — withholding them entirely would lose real occurrences. Only
    // fully suppressed ones are omitted.
    await inRollback(async (tx) => {
      const taxonId = await taxonWhere("sensitivity = '重度' and is_in_taiwan");
      const r = await insertReport(tx, { taxonId });
      await tx`update reports set source = 'user' where id = ${r.id}::uuid`;
      assert.ok(r.is_obscured, "fixture precondition: this taxon should be obscured");

      const rows = await exportable(tx, true);
      const found = rows.find((x) => x.id === r.id);
      assert.ok(found, "an obscured record should still be exported, with declared uncertainty");
      assert.notEqual(found.location_precision, "exact");
    });
  });

  test("unidentified records are opt-in", async () => {
    await inRollback(async (tx) => {
      const r = await insertReport(tx, { taxonId: null });
      await tx`update reports set source = 'user' where id = ${r.id}::uuid`;

      const without = await exportable(tx, false);
      const with_ = await exportable(tx, true);
      assert.ok(!without.some((x) => x.id === r.id), "excluded by default");
      assert.ok(with_.some((x) => x.id === r.id), "included with --include-unidentified");
    });
  });
});
