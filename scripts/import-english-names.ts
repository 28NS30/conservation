/**
 * Apply the committed English names to `taxa`.
 *
 *   npm run import:names-en
 *
 * Database only: reads scripts/english-names.json (written by
 * `npm run build:names-en`) and scripts/english-names-overrides.csv, and sets
 * common_name_en, alt_names_en, common_name_en_source and
 * common_name_en_inherited. No network, so it runs the same against production
 * as against a laptop, and running it twice changes nothing the second time.
 *
 * ORDER: after `npm run import:taicol`. TaiCOL's upsert does not touch these
 * columns, so re-importing TaiCOL keeps the names — but a taxon TaiCOL adds is
 * only named once this runs, and a name for a taxon TaiCOL has not delivered
 * yet has no row to land on (the run lists those as unknown).
 *
 * THE OVERRIDES FILE is the team's word and always wins over the sources:
 *
 *   taicol_id,common_name_en,note,reviewer
 *   t0032116,Leopard Cat,"MDD says Mainland Leopard Cat; …",team
 *   t0000000,,"no English name is right for this one",team
 *
 * A blank common_name_en means "show no English name", which is how a wrong
 * pick is removed without waiting for the source to fix it. An override on a
 * species reaches its subspecies (see resolveNames()).
 *
 * The database ends up holding exactly what the two files say: a name a source
 * stops giving is cleared on the next run rather than left behind.
 */
import { sql } from "./db.ts";
import {
  NAMES_PATH,
  OVERRIDES_PATH,
  applyEnglishNames,
  loadNamesFile,
  loadOverrides,
  resolveNames,
} from "./english-names.ts";

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");

async function main() {
  const file = loadNamesFile();
  const overrides = loadOverrides();
  const final = resolveNames(file, overrides);
  console.log(
    `English names: ${Object.keys(file.names).length.toLocaleString()} taxa in ${NAMES_PATH}` +
      ` (built ${file.generated_at}), ${overrides.length} overrides in ${OVERRIDES_PATH}\n`,
  );

  const res = await sql.begin((tx) => applyEnglishNames(tx, final));
  console.log(`  rows changed     ${res.changed.toLocaleString()}`);
  console.log(`  rows cleared     ${res.cleared.toLocaleString()}`);
  if (res.unknown.length) {
    console.warn(
      `  ! ${res.unknown.length} taicol_ids are not in taxa (run import:taicol first?): ` +
        res.unknown.slice(0, 10).join(", ") +
        (res.unknown.length > 10 ? ", …" : ""),
    );
  }

  const bySource = await sql<{ source: string | null; inherited: boolean; n: number }[]>`
    select common_name_en_source as source, common_name_en_inherited as inherited, count(*)::int as n
      from taxa
     where common_name_en is not null
     group by 1, 2
     order by 3 desc`;
  console.log("\n  named taxa by source");
  for (const r of bySource)
    console.log(`    ${String(r.n).padStart(5)}  ${r.source}${r.inherited ? " (inherited by subspecies)" : ""}`);

  // Coverage over what readers actually meet. Printed, never written anywhere:
  // `reports` includes records the public cannot see.
  const [c] = await sql<
    { rec_taxa: number; rec_taxa_named: number; records: number; records_named: number; inv: number; inv_named: number }[]
  >`
    with recorded as (
      select taxon_id, count(*)::int as n from reports where taxon_id is not null group by taxon_id
    )
    select (select count(*)::int from recorded)                                   as rec_taxa,
           (select count(*)::int from recorded r join taxa t on t.id = r.taxon_id
             where t.common_name_en is not null)                                   as rec_taxa_named,
           (select coalesce(sum(n), 0)::int from recorded)                         as records,
           (select coalesce(sum(r.n), 0)::int from recorded r join taxa t on t.id = r.taxon_id
             where t.common_name_en is not null)                                   as records_named,
           (select count(*)::int from taxa where is_invasive)                      as inv,
           (select count(*)::int from taxa where is_invasive and common_name_en is not null) as inv_named`;
  console.log(`
  coverage
    recorded taxa    ${c.rec_taxa_named}/${c.rec_taxa} (${pct(c.rec_taxa_named, c.rec_taxa)})
    records          ${c.records_named.toLocaleString()}/${c.records.toLocaleString()} (${pct(c.records_named, c.records)})
    invasive taxa    ${c.inv_named}/${c.inv} (${pct(c.inv_named, c.inv)})`);

  const gaps = await sql<{ scientific_name: string; common_name_zh: string | null; n: number }[]>`
    select t.scientific_name, t.common_name_zh, count(*)::int as n
      from reports r join taxa t on t.id = r.taxon_id
     where t.common_name_en is null
     group by t.id
     order by n desc, t.scientific_name
     limit 10`;
  if (gaps.length) {
    console.log("\n  most-recorded taxa with no English name (add them to the overrides file to name them)");
    for (const g of gaps) console.log(`    ${String(g.n).padStart(5)}  ${g.scientific_name}  ${g.common_name_zh ?? ""}`);
  }

  await sql.end();
}

main().catch(async (err) => {
  console.error("\nimport-english-names failed:\n", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
