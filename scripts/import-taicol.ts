/**
 * Import the Catalogue of Life in Taiwan (TaiCOL) into `taxa`.
 *
 *   npm run import:taicol
 *
 * Source: https://api.taicol.tw/v2/taxon — public, keyless, ~125k taxa.
 * Page size is capped at 300 server-side regardless of what `limit` asks for.
 *
 * All taxa are imported, not just species: the lineage walk in
 * resolve_taxa_lineage() needs the higher ranks to climb through.
 */
import { readFileSync } from "node:fs";
import { sql, fetchJson, mapPool, progress } from "./db.ts";
import { COLUMNS, toRow, type Page, type TaicolTaxon } from "./taicol-rows.ts";

const API = "https://api.taicol.tw/v2/taxon";
const PAGE = 300;

async function upsert(rows: ReturnType<typeof toRow>[]) {
  if (!rows.length) return;
  await sql`
    insert into taxa ${sql(rows, ...COLUMNS)}
    on conflict (taicol_id) do update set
      parent_taicol_id = excluded.parent_taicol_id,
      taxon_status     = excluded.taxon_status,
      scientific_name  = excluded.scientific_name,
      name_author      = excluded.name_author,
      common_name_zh   = excluded.common_name_zh,
      alt_names_zh     = excluded.alt_names_zh,
      rank             = excluded.rank,
      kingdom          = excluded.kingdom,
      is_in_taiwan     = excluded.is_in_taiwan,
      is_endemic       = excluded.is_endemic,
      alien_type       = excluded.alien_type,
      alien_status_note = excluded.alien_status_note,
      is_invasive      = excluded.is_invasive,
      protected_status = excluded.protected_status,
      cites            = excluded.cites,
      iucn             = excluded.iucn,
      redlist          = excluded.redlist,
      sensitivity      = excluded.sensitivity,
      is_terrestrial   = excluded.is_terrestrial,
      is_freshwater    = excluded.is_freshwater,
      is_brackish      = excluded.is_brackish,
      is_marine        = excluded.is_marine,
      updated_at       = excluded.updated_at`;
}

/**
 * `--from <file.jsonl>`: import a saved snapshot, one TaiCOL taxon per line,
 * instead of the live API. A refresh is checked on the local copy before it
 * reaches production, and production is written from SQL (taicol-sql.ts)
 * because this machine cannot reach its database; reading the same file on
 * both sides is what makes the check a check. The live API changes daily.
 */
async function importFile(path: string) {
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => toRow(JSON.parse(line) as TaicolTaxon));
  console.log(`${path}: ${rows.length.toLocaleString()} taxa\n`);
  for (let i = 0; i < rows.length; i += PAGE) {
    await upsert(rows.slice(i, i + PAGE));
    progress(Math.min(i + PAGE, rows.length), rows.length, "taxa");
  }
}

async function main() {
  const fromIdx = process.argv.indexOf("--from");
  if (fromIdx >= 0) {
    await importFile(process.argv[fromIdx + 1]);
    await finish();
    return;
  }
  const first = await fetchJson<Page>(`${API}?limit=${PAGE}&offset=0`);
  const total = first.info.total;
  console.log(`TaiCOL: ${total.toLocaleString()} taxa\n`);

  await upsert(first.data.map(toRow));

  const offsets: number[] = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);

  let done = first.data.length;
  // Concurrency 4 — enough to finish in a couple of minutes without hammering
  // a government API that costs someone real money to run.
  await mapPool(offsets, 4, async (offset) => {
    const page = await fetchJson<Page>(`${API}?limit=${PAGE}&offset=${offset}`);
    await upsert(page.data.map(toRow));
    done += page.data.length;
    progress(done, total, "taxa");
  });
  progress(total, total, "taxa");
  await finish();
}

/** Lineage, prompts and a summary, after either kind of import. */
async function finish() {
  console.log("\nResolving taxonomic lineage (walking parent_taxon_id)...");
  const t0 = Date.now();
  const [{ resolve_taxa_lineage: updated }] =
    await sql<{ resolve_taxa_lineage: string }[]>`select resolve_taxa_lineage()`;
  console.log(`  lineage resolved for ${Number(updated).toLocaleString()} taxa in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const [stats] = await sql<
    { total: string; taiwan_species: string; protected: string; sensitive: string; invasive: string; prompts: string }[]
  >`
    select count(*)                                                              as total,
           count(*) filter (where is_in_taiwan and rank = 'Species')             as taiwan_species,
           count(*) filter (where protected_status is not null)                  as protected,
           count(*) filter (where sensitivity is not null)                       as sensitive,
           count(*) filter (where is_invasive)                                   as invasive,
           count(*) filter (where bioclip_prompt is not null)                    as prompts
      from taxa`;

  console.log(`
  taxa rows        ${Number(stats.total).toLocaleString()}
  Taiwan species   ${Number(stats.taiwan_species).toLocaleString()}
  protected        ${Number(stats.protected).toLocaleString()}
  sensitivity-rated${" "} ${Number(stats.sensitive).toLocaleString()}
  invasive         ${Number(stats.invasive).toLocaleString()}
  BioCLIP prompts  ${Number(stats.prompts).toLocaleString()}`);

  await sql.end();
}

main().catch(async (err) => {
  console.error("\nTaiCOL import failed:\n", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
