/**
 * Write the SQL that fills taxa.new_taicol_id from a saved TaiCOL snapshot.
 *
 *   npx tsx scripts/taicol-successors-sql.ts data/cache/taicol-<date>.jsonl <out.sql>
 *
 * Migration 0034 adds the column empty; the import fills it from then on. The
 * rows already in a database came from a snapshot that carried the pointer and
 * lost it, so this puts it back from the same file without a re-import. One
 * statement, run the same way on both sides: `psql -1 -f` locally, the
 * Management API's query endpoint for production (docs/production-state.md).
 *
 * It writes that one column and nothing else, so the reblur trigger on taxa,
 * which fires only on the columns a rating is derived from, does not run and
 * no record moves. Only rows whose pointer differs are touched, so a second
 * run changes nothing. The value comes from toRow() in taicol-rows.ts, the
 * importer's own mapping.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { toRow, type TaicolTaxon } from "./taicol-rows.ts";

function successorsSql(rows: ReturnType<typeof toRow>[]): string {
  const pointers = rows
    .filter((r) => r.new_taicol_id)
    .map((r) => ({ taicol_id: r.taicol_id, new_taicol_id: r.new_taicol_id }));
  const json = JSON.stringify(pointers);
  if (json.includes("$taicol$")) throw new Error("snapshot contains the dollar-quote tag");
  return `set local lock_timeout = '5s';
update taxa t
   set new_taicol_id = x.new_taicol_id
  from jsonb_to_recordset($taicol$${json}$taicol$::jsonb) as x(taicol_id text, new_taicol_id text)
 where t.taicol_id = x.taicol_id
   and t.new_taicol_id is distinct from x.new_taicol_id;
`;
}

function main() {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) {
    console.error("usage: taicol-successors-sql.ts <snapshot.jsonl> <out.sql>");
    process.exit(2);
  }
  const rows = readFileSync(src, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => toRow(JSON.parse(line) as TaicolTaxon));
  const sql = successorsSql(rows);
  writeFileSync(out, sql);
  const n = rows.filter((r) => r.new_taicol_id).length;
  console.log(`${n.toLocaleString()} successor ids from ${rows.length.toLocaleString()} taxa in ${out}`);
}

main();
