/**
 * A TaiCOL refresh: one mapping, two ways to apply it.
 *
 * scripts/import-taicol.ts writes a snapshot to DATABASE_URL; production is
 * out of this machine's reach, so scripts/taicol-sql.ts writes the same
 * snapshot as SQL for the Management API. Both go through taicol-rows.ts. These
 * tests hold the mapping to what the importer needs, and run the generated SQL
 * against this database inside a transaction that is always rolled back.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql, inRollback } from "./helpers.mjs";
import { COLUMNS, toRow } from "../../../scripts/taicol-rows.ts";

after(() => sql.end());

const ROOT = join(import.meta.dirname, "..", "..", "..");

const MAGPIE = {
  taxon_id: "t-test-refresh-1",
  parent_taxon_id: null,
  taxon_status: "accepted",
  simple_name: "Testudo refreshii",
  name_author: "Test, 2026",
  common_name_c: "測試鵲",
  alternative_name_c: "甲, 乙",
  rank: "Species",
  kingdom: "Animalia",
  is_in_taiwan: true,
  is_endemic: false,
  alien_type: "native",
  alien_status_note: "臺灣: 引進種; 金門: 原生",
  protected: null,
  cites: null,
  iucn: null,
  redlist: null,
  sensitive: null,
  is_terrestrial: true,
  is_freshwater: false,
  is_brackish: false,
  is_marine: false,
  updated_at: "2026-09-01T00:00:00Z",
};

describe("the mapping", () => {
  test("keeps TaiCOL's regional alien note, which alien_type cannot say", () => {
    const r = toRow(MAGPIE);
    assert.equal(r.alien_status_note, "臺灣: 引進種; 金門: 原生");
    assert.equal(r.alien_type, "native");
    assert.ok(COLUMNS.includes("alien_status_note"));
  });

  test("derives the invasive flag and splits alternate names as before", () => {
    assert.equal(toRow({ ...MAGPIE, alien_type: "invasive" }).is_invasive, true);
    assert.equal(toRow(MAGPIE).is_invasive, false);
    assert.deepEqual(toRow(MAGPIE).alt_names_zh, ["甲", "乙"]);
  });
});

describe("the SQL written for production", () => {
  test("upserts a snapshot, new rows and changed ones, and resolves nothing else", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taicol-sql-"));
    const src = join(dir, "snapshot.jsonl");
    const [existing] = await sql`select taicol_id, scientific_name from taxa where taxon_status = 'accepted' limit 1`;
    writeFileSync(
      src,
      [MAGPIE, { ...MAGPIE, taxon_id: existing.taicol_id, simple_name: existing.scientific_name, common_name_c: "改名測試" }]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
    const out = join(dir, "sql");
    execFileSync("npx", ["tsx", join(ROOT, "scripts", "taicol-sql.ts"), src, out], { cwd: ROOT, stdio: "pipe" });
    const files = readdirSync(out).sort();
    assert.deepEqual(files, ["upsert-001.sql", "zz-lineage.sql"]);

    await inRollback(async (tx) => {
      await tx.unsafe(readFileSync(join(out, "upsert-001.sql"), "utf8"));
      const [added] = await tx`select common_name_zh, alien_status_note, is_in_taiwan from taxa where taicol_id = ${MAGPIE.taxon_id}`;
      assert.deepEqual(added, { common_name_zh: "測試鵲", alien_status_note: "臺灣: 引進種; 金門: 原生", is_in_taiwan: true });
      const [changed] = await tx`select common_name_zh from taxa where taicol_id = ${existing.taicol_id}`;
      assert.equal(changed.common_name_zh, "改名測試");
    });
  });
});
