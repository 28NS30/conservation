/**
 * A report filed here must not come back as a TaiRON import.
 *
 * Once records are shared with TaiRON, TaiRON's GBIF dataset will carry them
 * back to scripts/import-gbif.ts with our report id attached, and the map would
 * show the same animal twice. The importer looks every UUID a record carries up
 * among our own reports and skips a match.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback, insertReport } from "./helpers.mjs";
import { ownReportIdCandidates } from "../../../scripts/own-report-ids.ts";

after(() => sql.end());

const ID = "3f2b8c1e-9a4d-4e6f-8b21-5c7d9e0a1b2c";

describe("the ids a GBIF record can carry back", () => {
  test("found in each field a publisher uses to point at its source", () => {
    assert.deepEqual(ownReportIdCandidates({ occurrenceID: ID }), [ID]);
    assert.deepEqual(ownReportIdCandidates({ catalogNumber: `FW-${ID}` }), [ID]);
    assert.deepEqual(ownReportIdCandidates({ otherCatalogNumbers: `TaiRON:123 | ${ID}` }), [ID]);
    assert.deepEqual(ownReportIdCandidates({ otherCatalogNumbers: ["TaiRON:123", ID] }), [ID]);
    assert.deepEqual(
      ownReportIdCandidates({ references: `https://preservation-web-one.vercel.app/en/reports/${ID}` }),
      [ID],
    );
  });

  test("whatever the case, and each only once", () => {
    assert.deepEqual(
      ownReportIdCandidates({ occurrenceID: ID.toUpperCase(), references: `.../${ID}` }),
      [ID],
    );
  });

  test("and none from a TaiRON record that carries only its own numbers", () => {
    // TaiRON's occurrenceIDs are numbers (source_id "db09684b-…:31831"); the
    // dataset key is not in the record's own fields, so it cannot match.
    assert.deepEqual(ownReportIdCandidates({ occurrenceID: "31831" }), []);
    assert.deepEqual(ownReportIdCandidates({}), []);
  });
});

describe("the importer", () => {
  test("asks about our own reports only, before it inserts", () => {
    const src = readFileSync(join(import.meta.dirname, "../../../scripts/import-gbif.ts"), "utf8");
    assert.match(src, /own_ids: ownReportIdCandidates\(o\)/);
    assert.match(src, /where source = 'user' and id = any\(\$\{ids\}::uuid\[\]\)/);
    assert.match(src, /async function insertBatch\(all: Row\[\]\): Promise<number> \{\s*const rows = await withoutOwnReports\(all\);/);
  });

  test("the lookup finds a user report by the id a record carries", async () => {
    // The query withoutOwnReports() runs, against a real report.
    await inRollback(async (tx) => {
      const r = await insertReport(tx, {});
      const [{ id: reportId }] = await tx`select id::text as id from reports where id = ${r.id}`;
      const ids = ownReportIdCandidates({ references: `https://example.org/reports/${reportId}` });
      const hits = await tx`
        select id::text as id from reports
         where source = 'user' and id = any(${ids}::uuid[])`;
      assert.deepEqual(hits.map((h) => h.id), [reportId]);
    });
  });
});
