/**
 * List every name in use that is blurred less than a retired TaiCOL row it
 * replaced or shares a name with, and has no floor to make up the difference:
 * the pairs RETIRED_TWINS_SQL (taxa-overrides.ts) marks `looser`.
 *
 *   npx tsx scripts/retired-twins.ts                     # against DATABASE_URL
 *   npx tsx scripts/retired-twins.ts --sql > check.sql   # the query, for the Management API
 *   npx tsx scripts/retired-twins.ts --from data/cache/taicol-<date>.jsonl [--sql]
 *
 * preflight.ts and test/stricter-wins.test.mjs fail on the same pairs; this
 * says what each one is, so the owner can decide its floor: both names, both
 * rules, whether TaiCOL's own successor id or only a name links them, and how
 * many records the name in use and the rows under it hold.
 *
 * `--from` takes the successor ids from a snapshot instead of
 * taxa.new_taicol_id, for a database that does not have them yet: one where
 * migration 0034 is not applied or its column not filled. Production can only
 * be read through the Management API, so `--sql` prints the query instead of
 * running it.
 *
 * Read-only. Exits 1 when it lists anything.
 */
import { readFileSync } from "node:fs";
import { retiredTwinsSql, SUCCESSORS_IN_TAXA } from "./taxa-overrides.ts";
import { toRow, type TaicolTaxon } from "./taicol-rows.ts";

type Row = {
  retired_taicol_id: string;
  retired_name_zh: string | null;
  retired_scientific_name: string;
  retired_precision: string;
  taicol_id: string;
  name_zh: string | null;
  scientific_name: string;
  precision: string;
  by_successor: boolean;
  records: number;
};

function successorsFrom(path: string): string {
  const pointers = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => toRow(JSON.parse(line) as TaicolTaxon))
    .filter((r) => r.taxon_status === "deleted" && r.new_taicol_id)
    .map((r) => ({ taicol_id: r.taicol_id, new_taicol_id: r.new_taicol_id }));
  const json = JSON.stringify(pointers);
  if (json.includes("$successors$")) throw new Error("snapshot contains the dollar-quote tag");
  return `
    select x.taicol_id, x.new_taicol_id
      from jsonb_to_recordset($successors$${json}$successors$::jsonb)
           as x(taicol_id text, new_taicol_id text)`;
}

function checkSql(successors: string = SUCCESSORS_IN_TAXA): string {
  return `
select x.retired_taicol_id, d.common_name_zh as retired_name_zh,
       x.retired_scientific_name, x.retired_precision,
       x.taicol_id, n.common_name_zh as name_zh, x.scientific_name, x.precision,
       x.by_successor,
       (select count(*)::int from reports r
         where r.taxon_id in (select taxon_and_inheritors(x.taicol_id))) as records
  from (${retiredTwinsSql(successors)}) x
  join taxa d on d.taicol_id = x.retired_taicol_id
  join taxa n on n.taicol_id = x.taicol_id
 where x.looser
 order by records desc, x.taicol_id, x.retired_taicol_id;
`;
}

async function main() {
  const fromIdx = process.argv.indexOf("--from");
  const from = fromIdx >= 0 ? process.argv[fromIdx + 1] : undefined;
  if (fromIdx >= 0 && !from) {
    console.error("usage: retired-twins.ts [--from <snapshot.jsonl>] [--sql]");
    process.exit(2);
  }
  const query = checkSql(from ? successorsFrom(from) : undefined);
  if (process.argv.includes("--sql")) {
    process.stdout.write(query);
    return;
  }

  // Loaded here, not at the top: db.ts connects when it is loaded, and --sql
  // has nothing to connect to.
  const { sql } = await import("./db.ts");
  try {
    const rows = await sql.unsafe<Row[]>(query);
    for (const r of rows) {
      console.log(
        `${r.taicol_id} ${r.name_zh ?? ""} ${r.scientific_name} (${r.precision}, ` +
          `${r.records} record${r.records === 1 ? "" : "s"})  <  ` +
          `${r.retired_taicol_id} ${r.retired_name_zh ?? ""} ${r.retired_scientific_name} ` +
          `(${r.retired_precision})  ${r.by_successor ? "TaiCOL's successor" : "same name"}`,
      );
    }
    console.log(
      rows.length === 0
        ? "No name in use is blurred less than a retired row it replaced."
        : `\n${rows.length} pair(s) need a floor in scripts/taxa-overrides.csv, or the owner's decision that they do not.`,
    );
    process.exitCode = rows.length === 0 ? 0 : 1;
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
