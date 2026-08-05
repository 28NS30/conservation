/**
 * Build a labelled evaluation set for the species classifier.
 *
 *   npm run build:evalset -- --per-species 4 --species 80
 *
 * Why this source: the TaiRON roadkill dataset on GBIF publishes **no images**
 * (its `media` array is empty), so it cannot be used for evaluation despite being
 * expert-verified. iNaturalist's research-grade records for Taiwan can: ~1.95M
 * observations with CC-licensed photos and community-verified identifications.
 *
 * To keep the sample representative rather than arbitrary, species are chosen by
 * how often they actually appear in our seeded TaiRON roadkill data — so the eval
 * set matches the distribution the classifier will really encounter.
 *
 * KNOWN BIAS, and it matters when reading the numbers: iNaturalist photos are of
 * live, well-framed animals. Roadkill photos are of dead, often damaged animals on
 * asphalt, frequently at a distance. Accuracy measured here is an **optimistic
 * upper bound** for the roadkill category. Treat it as "can the model tell Taiwan
 * species apart at all", not "is it ready for roadkill".
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, fetchJson, progress } from "./db.ts";

const API = "https://api.gbif.org/v1/occurrence/search";
const INAT_DATASET = "50c9509d-22c7-4a22-a47d-8c48425ef4a7";
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "evalset");

type Occurrence = {
  key?: number;
  species?: string;
  media?: { type?: string; identifier?: string; license?: string; rightsHolder?: string }[];
};

type EvalItem = {
  gbifKey: number;
  taxonId: number;
  scientificName: string;
  commonNameZh: string | null;
  imageUrl: string;
  license: string | null;
  rightsHolder: string | null;
};

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

async function main() {
  const speciesCount = arg("species", 80);
  const perSpecies = arg("per-species", 4);

  // Species ranked by real roadkill frequency, restricted to taxa we can score
  // against (they need a BioCLIP prompt).
  const targets = await sql<{ id: number; scientific_name: string; common_name_zh: string | null; n: string }[]>`
    select t.id, t.scientific_name, t.common_name_zh, count(*)::text as n
      from reports r
      join taxa t on t.id = r.taxon_id
     where r.source = 'gbif'
       and t.bioclip_prompt is not null
     group by t.id, t.scientific_name, t.common_name_zh
     order by count(*) desc
     limit ${speciesCount}`;

  if (targets.length === 0) {
    console.error("No taxa found — run import:taicol and import:gbif first.");
    process.exit(1);
  }

  console.log(`Building eval set: ${targets.length} species x up to ${perSpecies} images\n`);

  const items: EvalItem[] = [];
  let done = 0;

  for (const t of targets) {
    const url =
      `${API}?datasetKey=${INAT_DATASET}&country=TW&mediaType=StillImage` +
      `&scientificName=${encodeURIComponent(t.scientific_name)}&limit=${perSpecies * 3}`;

    try {
      const page = await fetchJson<{ results: Occurrence[] }>(url);
      let taken = 0;
      for (const occ of page.results) {
        if (taken >= perSpecies) break;
        const img = occ.media?.find((m) => m.type === "StillImage" && m.identifier);
        if (!img?.identifier || occ.key == null) continue;
        items.push({
          gbifKey: occ.key,
          taxonId: t.id,
          scientificName: t.scientific_name,
          commonNameZh: t.common_name_zh,
          imageUrl: img.identifier,
          license: img.license ?? null,
          rightsHolder: img.rightsHolder ?? null,
        });
        taken++;
      }
    } catch (err) {
      console.warn(`\n  ! ${t.scientific_name}: ${(err as Error).message}`);
    }

    done++;
    progress(done, targets.length, "species");
    await new Promise((r) => setTimeout(r, 120)); // be gentle with GBIF
  }
  progress(targets.length, targets.length, "species");

  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, "evalset.jsonl");
  await writeFile(path, items.map((i) => JSON.stringify(i)).join("\n") + "\n");

  const speciesWithImages = new Set(items.map((i) => i.taxonId)).size;
  console.log(`
  wrote            ${path}
  images           ${items.length}
  species covered  ${speciesWithImages}/${targets.length}

  Images are CC-licensed via iNaturalist; attribution is stored per item.
  Next: apps/ml/evaluate.py reads this file.`);

  await sql.end();
}

main().catch(async (err) => {
  console.error("\nEval set build failed:\n", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
