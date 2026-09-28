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
 *
 * The export's own query and mapping are used, from scripts/dwc-occurrences.ts,
 * rather than a copy "kept in step" — a copy is what drifts.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback, insertReport, taxonWhere } from "./helpers.mjs";
import {
  selectOccurrences,
  toOccurrence,
  TERMS,
} from "../../../scripts/dwc-occurrences.ts";

after(() => sql.end());

/** The export's row query, run on the test's own transaction. */
const exportable = (tx, includeUnidentified = false) =>
  selectOccurrences(tx, { includeUnidentified });

const DATASET_TITLE = "Test dataset";
const CC_BY = "http://creativecommons.org/licenses/by/4.0/legalcode";
const CC0 = "http://creativecommons.org/publicdomain/zero/1.0/legalcode";

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

describe("a licence is the contributor's to grant", () => {
  /*
   * The report form has never asked anyone for a licence, so a user record
   * carries none. The export used to fill the gap with the dataset's own
   * CC BY 4.0 — telling GBIF, and everyone downstream of it, that each
   * reporter had granted a licence they were never asked for. A record now
   * goes out under the licence it carries, or not at all.
   */
  async function userRecord(tx, { license = null } = {}) {
    const taxonId = await taxonWhere(
      "is_in_taiwan and sensitivity is null and protected_status is null",
    );
    const r = await insertReport(tx, { taxonId });
    await tx`update reports set source = 'user', license = ${license}
              where id = ${r.id}::uuid`;
    const row = (await exportable(tx, true)).find((x) => x.id === r.id);
    assert.ok(row, "fixture precondition: a published user record is a candidate");
    return row;
  }

  test("a user record nobody licensed is not exported", async () => {
    await inRollback(async (tx) => {
      const row = await userRecord(tx, { license: null });
      assert.equal(
        toOccurrence(row, DATASET_TITLE),
        null,
        "an unlicensed record was published under a licence nobody granted",
      );
    });
  });

  test("nor is one whose licence is blank", async () => {
    await inRollback(async (tx) => {
      const row = await userRecord(tx, { license: "   " });
      assert.equal(toOccurrence(row, DATASET_TITLE), null);
    });
  });

  test("a licensed one goes out under its own licence, not the dataset's", async () => {
    await inRollback(async (tx) => {
      const row = await userRecord(tx, { license: CC0 });
      const out = toOccurrence(row, DATASET_TITLE);
      assert.ok(out, "a licensed record should be exported");
      assert.equal(out.license, CC0);
      assert.notEqual(out.license, CC_BY);
    });
  });

  test("the script has no fallback to the dataset's licence", () => {
    const script = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "scripts", "export-dwca.ts"),
      "utf8",
    );
    assert.doesNotMatch(script, /\?\?\s*DATASET\.license/);
    assert.match(script, /toOccurrence\(r, DATASET\.title\)/);
  });
});

describe("the reporter's notes stay here", () => {
  /*
   * Free text typed into a report form, by someone told it was a note to us.
   * It can hold a name, a phone number or the exact place in words — the one
   * thing the coordinate blur cannot reach. It used to be appended to
   * occurrenceRemarks.
   */
  const NOTE = "under the bridge behind No. 12 Zhongshan Rd, call 0912-345-678";

  test("no field of the archive carries them", async () => {
    await inRollback(async (tx) => {
      const taxonId = await taxonWhere(
        "is_in_taiwan and sensitivity is null and protected_status is null",
      );
      const r = await insertReport(tx, { taxonId });
      await tx`update reports set source = 'user', license = ${CC_BY}, notes = ${NOTE}
                where id = ${r.id}::uuid`;
      const row = (await exportable(tx, true)).find((x) => x.id === r.id);
      assert.ok(row, "fixture precondition");
      assert.ok(!("notes" in row), "the query should not even read them");

      // And the mapping ignores them even if a later query hands them over:
      // two independent guards, so one careless edit is not enough.
      const out = toOccurrence({ ...row, notes: NOTE }, DATASET_TITLE);
      assert.ok(out);
      for (const term of TERMS)
        assert.ok(
          !String(out[term] ?? "").includes("Zhongshan"),
          `${term} carries the reporter's note`,
        );
      assert.equal(out.occurrenceRemarks, "roadkill", "the category, and only that");
    });
  });
});
