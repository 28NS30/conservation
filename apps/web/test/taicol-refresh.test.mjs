/**
 * A TaiCOL refresh: one mapping, two ways to apply it.
 *
 * scripts/import-taicol.ts writes a snapshot to DATABASE_URL; production is
 * out of this machine's reach, so scripts/taicol-sql.ts writes the same
 * snapshot as SQL for the Management API. Both go through taicol-rows.ts. These
 * tests hold the mapping to what the importer needs, and run the generated SQL
 * against this database inside a transaction that is always rolled back. So
 * does the fill that came with TaiCOL's successor ids (migration 0034), for
 * rows imported before the column existed.
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
  new_taxon_id: null,
};

/** A name TaiCOL retired and moved to MAGPIE, sharing none of its names. */
const RETIRED = {
  ...MAGPIE,
  taxon_id: "t-test-refresh-2",
  taxon_status: "deleted",
  simple_name: "Testudo veterii",
  common_name_c: "舊名測試",
  alternative_name_c: null,
  new_taxon_id: MAGPIE.taxon_id,
};

const snapshot = (rows) => {
  const dir = mkdtempSync(join(tmpdir(), "taicol-sql-"));
  const src = join(dir, "snapshot.jsonl");
  writeFileSync(src, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { dir, src };
};

const tsx = (script, ...args) =>
  execFileSync("npx", ["tsx", join(ROOT, "scripts", script), ...args], { cwd: ROOT, stdio: "pipe" })
    .toString();

describe("the mapping", () => {
  test("keeps TaiCOL's regional alien note, which alien_type cannot say", () => {
    const r = toRow(MAGPIE);
    assert.equal(r.alien_status_note, "臺灣: 引進種; 金門: 原生");
    assert.equal(r.alien_type, "native");
    assert.ok(COLUMNS.includes("alien_status_note"));
  });

  test("keeps TaiCOL's pointer from a retired row to the row that replaced it", () => {
    // A rename shares no name with what it renamed, so this is the only link
    // RETIRED_TWINS_SQL can follow from a rating left on the retired row.
    assert.equal(toRow(RETIRED).new_taicol_id, MAGPIE.taxon_id);
    assert.equal(toRow(MAGPIE).new_taicol_id, null);
    const { new_taxon_id, ...older } = MAGPIE;
    assert.equal(toRow(older).new_taicol_id, null, "a snapshot without the field");
    assert.ok(COLUMNS.includes("new_taicol_id"));
  });

  test("derives the invasive flag and splits alternate names as before", () => {
    assert.equal(toRow({ ...MAGPIE, alien_type: "invasive" }).is_invasive, true);
    assert.equal(toRow(MAGPIE).is_invasive, false);
    assert.deepEqual(toRow(MAGPIE).alt_names_zh, ["甲", "乙"]);
  });
});

describe("the SQL written for production", () => {
  test("upserts a snapshot, new rows and changed ones, and resolves nothing else", async () => {
    const [existing] = await sql`select taicol_id, scientific_name from taxa where taxon_status = 'accepted' limit 1`;
    const { dir, src } = snapshot([
      MAGPIE,
      RETIRED,
      { ...MAGPIE, taxon_id: existing.taicol_id, simple_name: existing.scientific_name, common_name_c: "改名測試" },
    ]);
    const out = join(dir, "sql");
    tsx("taicol-sql.ts", src, out);
    const files = readdirSync(out).sort();
    assert.deepEqual(files, ["upsert-001.sql", "zz-lineage.sql"]);

    await inRollback(async (tx) => {
      await tx.unsafe(readFileSync(join(out, "upsert-001.sql"), "utf8"));
      const [added] = await tx`select common_name_zh, alien_status_note, is_in_taiwan from taxa where taicol_id = ${MAGPIE.taxon_id}`;
      assert.deepEqual(added, { common_name_zh: "測試鵲", alien_status_note: "臺灣: 引進種; 金門: 原生", is_in_taiwan: true });
      const [retired] = await tx`select new_taicol_id from taxa where taicol_id = ${RETIRED.taxon_id}`;
      assert.equal(retired.new_taicol_id, MAGPIE.taxon_id);
      const [changed] = await tx`select common_name_zh from taxa where taicol_id = ${existing.taicol_id}`;
      assert.equal(changed.common_name_zh, "改名測試");
    });
  });
});

describe("the successor ids, for rows imported before 0034", () => {
  // Inserted by hand, without the pointer, as every row imported before the
  // column existed was.
  const insertBoth = async (tx) => {
    for (const t of [MAGPIE, RETIRED]) {
      await tx`insert into taxa (taicol_id, scientific_name, common_name_zh, rank, kingdom,
                                 is_in_taiwan, taxon_status, sensitivity)
               values (${t.taxon_id}, ${t.simple_name}, ${t.common_name_c}, 'Species',
                       'Animalia', true, ${t.taxon_status},
                       ${t === RETIRED ? "座標不開放" : null})`;
    }
  };

  test("are filled from the snapshot, in that column alone, once", async () => {
    const { dir, src } = snapshot([MAGPIE, RETIRED]);
    const out = join(dir, "successors.sql");
    tsx("taicol-successors-sql.ts", src, out);
    const fill = readFileSync(out, "utf8");

    await inRollback(async (tx) => {
      // A trigger that throws on UPDATE OF every other column of taxa: the
      // reblur trigger listens to some of them, and the fill must name none.
      // Created before anything else here, so this transaction never waits
      // for a stronger lock on taxa than the first one it takes.
      const cols = await tx`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'taxa'
           and column_name <> 'new_taicol_id'`;
      await tx.unsafe(`
        create function successor_ids_sentinel() returns trigger language plpgsql as $$
        begin
          raise exception 'the successor fill named a column other than new_taicol_id';
        end $$`);
      await tx.unsafe(`
        create trigger successor_ids_sentinel before update of ${cols.map((c) => `"${c.column_name}"`).join(", ")}
          on taxa for each row execute function successor_ids_sentinel()`);
      await insertBoth(tx);

      await tx.unsafe(fill);
      const [row] = await tx`select new_taicol_id, ctid::text from taxa where taicol_id = ${RETIRED.taxon_id}`;
      assert.equal(row.new_taicol_id, MAGPIE.taxon_id);
      const [magpie] = await tx`select new_taicol_id from taxa where taicol_id = ${MAGPIE.taxon_id}`;
      assert.equal(magpie.new_taicol_id, null);

      // A second run writes no row: an update would move the row's ctid.
      await tx.unsafe(fill);
      const [again] = await tx`select ctid::text from taxa where taicol_id = ${RETIRED.taxon_id}`;
      assert.equal(again.ctid, row.ctid);
    });
  });
});
