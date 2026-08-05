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
import { sql, fetchJson, mapPool, progress } from "./db.ts";

const API = "https://api.taicol.tw/v2/taxon";
const PAGE = 300;

type TaicolTaxon = {
  taxon_id: string;
  parent_taxon_id: string | null;
  taxon_status: string | null;
  simple_name: string;
  name_author: string | null;
  common_name_c: string | null;
  alternative_name_c: string | null;
  rank: string | null;
  kingdom: string | null;
  is_in_taiwan: boolean | null;
  is_endemic: boolean | null;
  alien_type: string | null;
  protected: string | null;
  cites: string | null;
  iucn: string | null;
  redlist: string | null;
  sensitive: string | null;
  is_terrestrial: boolean | null;
  is_freshwater: boolean | null;
  is_brackish: boolean | null;
  is_marine: boolean | null;
  updated_at: string | null;
};

type Page = { info: { total: number }; data: TaicolTaxon[] };

function toRow(t: TaicolTaxon) {
  const alt = t.alternative_name_c
    ? t.alternative_name_c.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  return {
    taicol_id: t.taxon_id,
    parent_taicol_id: t.parent_taxon_id,
    taxon_status: t.taxon_status,
    scientific_name: t.simple_name,
    name_author: t.name_author,
    common_name_zh: t.common_name_c,
    alt_names_zh: alt,
    rank: t.rank,
    kingdom: t.kingdom,
    is_in_taiwan: t.is_in_taiwan ?? false,
    is_endemic: t.is_endemic ?? false,
    alien_type: t.alien_type,
    // TaiCOL encodes invasiveness inside alien_type rather than as a flag.
    is_invasive: (t.alien_type ?? "").toLowerCase().includes("invasive"),
    protected_status: t.protected,
    cites: t.cites,
    iucn: t.iucn,
    redlist: t.redlist,
    sensitivity: t.sensitive,
    is_terrestrial: t.is_terrestrial,
    is_freshwater: t.is_freshwater,
    is_brackish: t.is_brackish,
    is_marine: t.is_marine,
    updated_at: t.updated_at ? new Date(t.updated_at) : null,
  };
}

const COLUMNS = [
  "taicol_id", "parent_taicol_id", "taxon_status", "scientific_name", "name_author",
  "common_name_zh", "alt_names_zh", "rank", "kingdom", "is_in_taiwan", "is_endemic",
  "alien_type", "is_invasive", "protected_status", "cites", "iucn", "redlist",
  "sensitivity", "is_terrestrial", "is_freshwater", "is_brackish", "is_marine", "updated_at",
] as const;

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

async function main() {
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
