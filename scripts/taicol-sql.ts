/**
 * Write a TaiCOL snapshot as SQL, for a database this machine cannot connect to.
 *
 *   npx tsx scripts/taicol-sql.ts data/cache/taicol-<date>.jsonl data/cache/taicol-sql [--chunk 2000]
 *
 * Production's DATABASE_URL is not obtainable here (docs/production-state.md),
 * so a refresh reaches it through the Supabase Management API's query
 * endpoint, a statement at a time. This writes numbered files for that: each
 * the same upsert scripts/import-taicol.ts runs, over one slice of the
 * snapshot, and a last one that resolves the lineage. The mapping is
 * taicol-rows.ts, shared with the importer, so the local check and the
 * production write cannot differ.
 *
 * Apply migration 0023 first: it adds the column the snapshot now carries, and
 * the floors that hold every rating the refresh would weaken.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COLUMNS, toRow, type TaicolTaxon } from "./taicol-rows.ts";

/**
 * Rows per file. 2,000 keeps every file near 1 MB: at 5,000 the first refresh
 * (29 September 2026) had one slice, heavy with long names and notes, that the
 * query endpoint refused as "request entity too large". `--chunk N` overrides.
 */
const CHUNK = (() => {
  const i = process.argv.indexOf("--chunk");
  return i >= 0 ? Number(process.argv[i + 1]) : 2000;
})();

const TYPES: Record<(typeof COLUMNS)[number], string> = {
  taicol_id: "text", parent_taicol_id: "text", taxon_status: "text",
  scientific_name: "text", name_author: "text", common_name_zh: "text",
  alt_names_zh: "text[]", rank: "text", kingdom: "text", is_in_taiwan: "boolean",
  is_endemic: "boolean", alien_type: "text", alien_status_note: "text",
  is_invasive: "boolean", protected_status: "text", cites: "text", iucn: "text",
  redlist: "text", sensitivity: "text", is_terrestrial: "boolean",
  is_freshwater: "boolean", is_brackish: "boolean", is_marine: "boolean",
  updated_at: "timestamptz",
};

function upsertSql(rows: ReturnType<typeof toRow>[]): string {
  const json = JSON.stringify(rows);
  if (json.includes("$taicol$")) throw new Error("snapshot contains the dollar-quote tag");
  const cols = COLUMNS.join(", ");
  const record = COLUMNS.map((c) => `${c} ${TYPES[c]}`).join(", ");
  const set = COLUMNS.filter((c) => c !== "taicol_id")
    .map((c) => `${c} = excluded.${c}`)
    .join(",\n      ");
  return `set local lock_timeout = '5s';
insert into taxa (${cols})
select ${cols}
  from jsonb_to_recordset($taicol$${json}$taicol$::jsonb) as x(${record})
on conflict (taicol_id) do update set
      ${set};
`;
}

function main() {
  const [src, outDir] = process.argv.slice(2).filter((a, i, all) => a !== "--chunk" && all[i - 1] !== "--chunk");
  if (!src || !outDir) {
    console.error("usage: taicol-sql.ts <snapshot.jsonl> <out-dir>");
    process.exit(2);
  }
  const rows = readFileSync(src, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => toRow(JSON.parse(line) as TaicolTaxon));
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    n++;
    writeFileSync(join(outDir, `upsert-${String(n).padStart(3, "0")}.sql`), upsertSql(rows.slice(i, i + CHUNK)));
  }
  writeFileSync(join(outDir, "zz-lineage.sql"), "select resolve_taxa_lineage();\n");
  console.log(`${rows.length.toLocaleString()} taxa in ${n} files, then zz-lineage.sql, in ${outDir}`);
}

main();
