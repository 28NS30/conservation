/**
 * Repair the taxon of every record the GBIF import named wrongly.
 *
 *   npx tsx scripts/remap-gbif-taxa.ts            # dry run: changes nothing
 *   npx tsx scripts/remap-gbif-taxa.ts --apply    # write to THIS database
 *   npx tsx scripts/remap-gbif-taxa.ts --refresh  # re-page GBIF, ignore the cache
 *   npx tsx scripts/remap-gbif-taxa.ts --no-api   # local resolution only
 *
 * "Dry run" is about the database. The three artefacts below are written on
 * every run — reading them is how you decide whether to pass --apply.
 *
 * Which means the run that applies is the run whose artefacts you keep. They
 * describe the difference between the database and what the matcher wants, so
 * once a database matches, an honest report of it is empty. Run --apply, commit
 * what it wrote, and do not re-run against the same database afterwards
 * expecting to see the change again.
 *
 * `import-gbif.ts` matched TaiRON's records against TaiCOL's *accepted* names, so
 * every row carrying a superseded synonym matched nothing or matched the wrong
 * taxon. The importer is idempotent — re-running it repairs nothing — so the rows
 * already stored need this one-off pass. Fixing the matcher (scripts/taxon-names.ts)
 * only stops it happening again.
 *
 * Three artefacts come out:
 *
 *   scripts/taxon-crosswalk.json    published name → TaiCOL id. Committed, and
 *                                   read by the importer so new rows match too.
 *   scripts/taxon-remap-report.csv  every group of records that moves, with the
 *                                   precision it had and the precision it gains.
 *   scripts/taxon-remap.sql         plain UPDATEs keyed on source_id, for the
 *                                   owner to review and run against production.
 *
 * WHY THE REPORT LEADS WITH LOOSENING. Precision follows the taxon. Migration
 * 0011 blurs an untaxoned record to 10 km because nobody knows what is on that
 * pin; naming it replaces that with the taxon's own policy, which for an animal
 * nobody protects is `exact`. So this un-blurs records — the 14 dogs currently
 * hidden as protected wolves among them. That is the right answer and it is also
 * a publication decision, so the report separates the records that become *more*
 * precise from those that become less, names the taxa, and never hides a
 * disclosure inside a total. The owner signs off before production runs anything.
 *
 * The reverse direction — a record that matched nothing and is now matched to a
 * protected or sensitive taxon, so becomes blurred — is safe and needs no
 * permission.
 *
 * This never re-identifies an animal. TaiRON said what it saw; all that changes
 * is which checklist entry that name points at.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { sql, fetchJson, mapPool, progress } from "./db.ts";
import {
  CROSSWALK_PATH,
  elevatedSubspecies,
  loadCrosswalk,
  loadTaxonIndex,
  matchLocal,
  matchTaxon,
  publishedName,
  type Crosswalk,
  type CrosswalkEntry,
  type NameParts,
  type TaxonIndex,
  type TaxonRow,
} from "./taxon-names.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CACHE_DIR = join(REPO, "data", "cache");
const PAGE_CACHE_DIR = join(CACHE_DIR, "gbif-tairon-names");
const TAICOL_CACHE = join(CACHE_DIR, "taicol-namematch.json");
const REPORT_PATH = join(HERE, "taxon-remap-report.csv");
const SQL_PATH = join(HERE, "taxon-remap.sql");

const GBIF_API = "https://api.gbif.org/v1/occurrence/search";
const TAICOL_API = "https://api.taicol.tw/v2/nameMatch";
const TAIRON_DATASET = "db09684b-0fd1-431e-b5fa-4c1532fbdb14";
const PAGE = 300;
/** Above the 658 names this dataset holds, with room for it to grow. */
const FACET_LIMIT = 2000;
/** GBIF is a public good and often slow; a few pages in flight, not a stampede. */
const FETCH_CONCURRENCY = 6;
/**
 * Generous, because `fetchJson`'s 60s default abandons a nearly-complete
 * transfer and starts it again from nothing. Waiting is not the cost here.
 */
const PAGE_TIMEOUT_MS = 300_000;

/** Precision, least to most disclosing. Mirrors precision_rank() in 0003. */
const PRECISION_ORDER = ["suppressed", "coarse_50km", "coarse_10km", "exact"];
const disclosure = (p: string) => PRECISION_ORDER.indexOf(p);

// ---------------------------------------------------------------------------
// The names TaiRON published
// ---------------------------------------------------------------------------

type CachedName = {
  /** `reports.source_id`: the dataset key and occurrenceID, as the importer built it. */
  source_id: string;
  /** The Darwin Core atoms, kept apart so the matcher sees what GBIF served. */
  parts: NameParts;
  /** `parts` joined: the binomial or trinomial TaiRON published, or null. */
  published: string | null;
};

type GbifOccurrence = {
  occurrenceID?: string;
  gbifID?: string | number;
  species?: string;
  scientificName?: string;
  genericName?: string;
  specificEpithet?: string;
  infraspecificEpithet?: string;
  datasetKey?: string;
};

type SearchPage = { count: number; results: GbifOccurrence[]; endOfRecords: boolean };
type FacetPage = {
  count: number;
  facets?: { field: string; counts: { name: string; count: number }[] }[];
};

/**
 * Fetch the three name atoms for every TaiRON occurrence, one published name at
 * a time.
 *
 * NOT by walking `offset` through the whole dataset, which is the obvious way
 * and was the first way. GBIF's occurrence search degrades sharply with offset
 * depth: measured here, `offset=45000&limit=300` served 4 KB/s and did not
 * finish inside two minutes, while the same page filtered to one
 * `verbatimScientificName` returned 1.4 MB in 2.7 seconds. Same endpoint, same
 * dataset, same 300 records — 125x, because the filter keeps every offset
 * shallow. Deep paging would have taken about two hours and leaned on a public
 * API for all of it.
 *
 * So: one facet request names all 658 strings TaiRON published and how many
 * records carry each, then each name is paged on its own. The facet counts also
 * check the work — a name whose pages do not add up to its count is a short
 * read, and it says so rather than silently leaving records unmapped.
 *
 * Cached one file per name under `data/cache/`, which is gitignored: an
 * interrupted run resumes at the first name it has not got, and re-running costs
 * nothing.
 */
async function loadPublishedNames(refresh: boolean): Promise<CachedName[]> {
  mkdirSync(PAGE_CACHE_DIR, { recursive: true });

  const base =
    `${GBIF_API}?datasetKey=${TAIRON_DATASET}` +
    `&hasCoordinate=true&hasGeospatialIssue=false`;

  const facet = await fetchJson<FacetPage>(
    `${base}&limit=0&facet=verbatimScientificName&facetLimit=${FACET_LIMIT}`,
    { timeoutMs: PAGE_TIMEOUT_MS },
  );
  const names = facet.facets?.[0]?.counts ?? [];
  const faceted = names.reduce((n, c) => n + c.count, 0);
  console.log(
    `Names: ${facet.count.toLocaleString()} TaiRON occurrences under ` +
      `${names.length.toLocaleString()} published names`,
  );
  if (!names.length) throw new Error("GBIF returned no verbatimScientificName facet");
  if (faceted !== facet.count)
    throw new Error(
      `facet covers ${faceted} of ${facet.count} records — raise FACET_LIMIT ` +
        `(currently ${FACET_LIMIT}) rather than remapping part of the dataset`,
    );

  const wanted = refresh ? names : names.filter((c) => !existsSync(namePath(c.name)));
  console.log(`  ${names.length - wanted.length}/${names.length} already cached`);

  let done = names.length - wanted.length;
  const short: string[] = [];
  await mapPool(wanted, FETCH_CONCURRENCY, async ({ name, count }) => {
    const rows: CachedName[] = [];
    for (let offset = 0; offset < count; offset += PAGE) {
      const page = await fetchJson<SearchPage>(
        `${base}&verbatimScientificName=${encodeURIComponent(name)}` +
          `&limit=${PAGE}&offset=${offset}`,
        { timeoutMs: PAGE_TIMEOUT_MS },
      );
      rows.push(...distil(page.results));
      if (page.endOfRecords) break;
    }
    if (rows.length !== count) short.push(`${name}: ${rows.length} of ${count}`);
    writeFileSync(namePath(name), JSON.stringify(rows));
    progress(++done, names.length, "GBIF names");
  });
  progress(names.length, names.length, "GBIF names");
  for (const s of short) console.log(`  ! short read — ${s}`);

  const out: CachedName[] = [];
  for (const { name } of names) {
    if (!existsSync(namePath(name))) continue;
    out.push(...(JSON.parse(readFileSync(namePath(name), "utf8")) as CachedName[]));
  }
  console.log(`  ${out.length.toLocaleString()} occurrences with an id`);
  return out;
}

/**
 * One cache file per published name.
 *
 * The name is slugified for the filesystem and a hash of the original is
 * appended, because slugifying is lossy: "Rattus Fischer, 1803" and
 * "Rattus Fischer 1803" would otherwise share a file and one would be read as
 * the other.
 */
function namePath(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  const hash = createHash("sha1").update(name).digest("hex").slice(0, 8);
  return join(PAGE_CACHE_DIR, `${slug}-${hash}.json`);
}

function distil(results: GbifOccurrence[]): CachedName[] {
  const out: CachedName[] = [];
  for (const o of results) {
    const id = o.occurrenceID ?? (o.gbifID != null ? String(o.gbifID) : null);
    if (!id) continue;
    const parts: NameParts = {
      genericName: o.genericName,
      specificEpithet: o.specificEpithet,
      infraspecificEpithet: o.infraspecificEpithet,
      species: o.species,
      scientificName: o.scientificName,
    };
    out.push({
      source_id: `${o.datasetKey ?? "gbif"}:${id}`,
      parts,
      published: publishedName(parts),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// TaiCOL, for the names local data cannot resolve
// ---------------------------------------------------------------------------

type TaicolMatch = {
  matched_name?: string;
  taxon_id?: string;
  accepted_name?: string;
};
type TaicolReply = {
  status?: { code?: number };
  info?: { total?: number };
  data?: TaicolMatch[];
};

type ApiVerdict =
  | { ok: true; taicol_id: string; matched_name: string }
  | { ok: false; why: string };

/** Answers already fetched, so a re-run costs no requests. */
let taicolCache: Record<string, TaicolReply | { error: string }> = {};

function loadTaicolCache() {
  try {
    taicolCache = JSON.parse(readFileSync(TAICOL_CACHE, "utf8"));
  } catch {
    taicolCache = {};
  }
}

function saveTaicolCache() {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(TAICOL_CACHE, JSON.stringify(taicolCache, null, 2));
}

/**
 * Ask TaiCOL what a published name means, and accept the answer only when it is
 * unambiguous.
 *
 * Three conditions, all required: exactly one taxon comes back, the name TaiCOL
 * matched is the name we asked about, and the taxon it names lives in Taiwan.
 * Anything looser is a guess, and a guessed crosswalk entry would silently
 * re-identify somebody's record. "Sinomicrurus macclellandi" is the cautionary
 * case the brief names: it matches a subspecies string, so a human reviews it.
 */
async function askTaicol(name: string, idx: TaxonIndex): Promise<ApiVerdict> {
  let reply = taicolCache[name];
  if (reply === undefined) {
    try {
      reply = await fetchJson<TaicolReply>(
        `${TAICOL_API}?name=${encodeURIComponent(name)}`,
        { retries: 2, timeoutMs: 20_000 },
      );
    } catch (err) {
      reply = { error: (err as Error).message };
    }
    taicolCache[name] = reply;
  }
  if ("error" in reply) return { ok: false, why: `taicol unreachable: ${reply.error}` };
  if (reply.status?.code !== 200) return { ok: false, why: "taicol error reply" };

  const data = reply.data ?? [];
  if (data.length === 0) return { ok: false, why: "taicol knows no such name" };

  const ids = [...new Set(data.map((d) => d.taxon_id).filter(Boolean))] as string[];
  if (ids.length !== 1)
    return { ok: false, why: `taicol returned ${ids.length} taxa — ambiguous` };

  const matched = data[0].matched_name?.trim() ?? "";
  if (matched.toLowerCase() !== name.toLowerCase())
    return { ok: false, why: `taicol matched "${matched}", not the published name` };

  const local = idx.byTaicolId.get(ids[0]);
  if (!local) return { ok: false, why: `${ids[0]} is not in our taxa table` };
  if (!local.is_in_taiwan) return { ok: false, why: `${ids[0]} is not in Taiwan` };

  return { ok: true, taicol_id: ids[0], matched_name: matched };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

type Resolution =
  | { taxon: TaxonRow; via: string }
  | { taxon: null; why: string };

/**
 * Resolve one published name that the importer's exact match could not.
 *
 * Local first, and only then the network: TaiCOL's `taicol_id` has to exist in
 * our own `taxa` table to be usable at all, so local evidence is both cheaper and
 * closer to what we will actually write. `taxa` holds one row per TaiCOL *taxon*
 * and therefore no synonyms at all, so the only local evidence a Latin name can
 * draw on is the shape of the name itself — which is why the local answer is
 * then put to TaiCOL rather than trusted on its own.
 *
 * The three outcomes of that check are deliberately different:
 *
 *   agrees      — two independent routes, same taxon. Strongest entry in the file.
 *   contradicts — a real conflict about what an animal is called. We refuse both
 *                 answers and list the name, because picking one here would be
 *                 this script deciding a taxonomic question on its own.
 *   silent      — TaiCOL unreachable, or its answer fails the acceptance rules.
 *                 Keep the local answer and say in `via` that nothing confirmed
 *                 it, so a reader of the crosswalk can see which entries rest on
 *                 one source.
 */
async function resolve(
  name: string,
  idx: TaxonIndex,
  useApi: boolean,
): Promise<Resolution> {
  const local = elevatedSubspecies(idx, name);

  if (!useApi)
    return local
      ? { taxon: local, via: "local:subspecies-raised-to-species (unconfirmed)" }
      : { taxon: null, why: "unresolved (TaiCOL not consulted)" };

  const verdict = await askTaicol(name, idx);

  if (local) {
    if (!verdict.ok)
      return {
        taxon: local,
        via: `local:subspecies-raised-to-species (unconfirmed: ${verdict.why})`,
      };
    if (verdict.taicol_id !== local.taicol_id)
      return {
        taxon: null,
        why:
          `the name suggests ${local.scientific_name} (${local.taicol_id}) but TaiCOL ` +
          `says ${verdict.taicol_id}. A biologist decides; nothing is remapped.`,
      };
    return { taxon: local, via: "local:subspecies-raised-to-species (TaiCOL agrees)" };
  }

  if (verdict.ok) {
    const taxon = idx.byTaicolId.get(verdict.taicol_id)!;
    return { taxon, via: "taicol:nameMatch" };
  }
  return { taxon: null, why: verdict.why };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type DbRow = {
  source_id: string;
  taxon_id: number | null;
  location_precision: string;
};

/** One line of the report: a set of records that all gain the same taxon. */
type Group = {
  published: string | null;
  gbifSpecies: string | null;
  oldTaxon: TaxonRow | null;
  newTaxon: TaxonRow | null;
  /** What `verbatim_name` becomes: null once a taxon is known, the name otherwise. */
  verbatim: string | null;
  via: string;
  sourceIds: string[];
  /** precision → count, filled from the database. */
  before: Map<string, number>;
  after: Map<string, number>;
  /**
   * Records that moved each way, counted one by one rather than read off the
   * group's commonest precision.
   *
   * A group is a set of records that all gain the same taxon; it is not a set of
   * records that all move the same way. `precision_override` is per record and
   * the most conservative of (taxon policy, override) wins, so a group can hand
   * most of its records a looser precision and leave a handful where they are.
   * Summarising by the commonest value would report that group as a single
   * direction and lose the others — and the ones it loses are the disclosure.
   */
  loosened: number;
  tightened: number;
};

const csvCell = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

function histogram(rows: { location_precision: string; n: number }[]) {
  return new Map(rows.map((r) => [r.location_precision, Number(r.n)]));
}

const bump = (h: Map<string, number>, k: string) => h.set(k, (h.get(k) ?? 0) + 1);

/** before/after side by side, most disclosing first. */
function renderHistogram(
  before: Map<string, number>,
  after: Map<string, number>,
): string {
  return [...PRECISION_ORDER]
    .reverse()
    .map((p) => {
      const b = before.get(p) ?? 0;
      const a = after.get(p) ?? 0;
      const d = a - b;
      const delta = d === 0 ? "" : `   ${d > 0 ? "+" : ""}${d.toLocaleString()}`;
      return `${p.padEnd(13)}${b.toLocaleString().padStart(7)}  ->${a.toLocaleString().padStart(7)}${delta}`;
    })
    .join("\n    ");
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const refresh = argv.includes("--refresh");
  const useApi = !argv.includes("--no-api");

  const idx = await loadTaxonIndex(sql);
  console.log(`Taxa: ${idx.byName.size.toLocaleString()} species/subspecies names`);
  loadTaicolCache();

  const names = await loadPublishedNames(refresh);
  const bySourceId = new Map(names.map((n) => [n.source_id, n]));

  const dbRows = await sql<DbRow[]>`
    select source_id, taxon_id, location_precision
      from reports
     where source = 'gbif' and source_id is not null`;
  console.log(`Records: ${dbRows.length.toLocaleString()} imported rows`);

  const missing = dbRows.filter((r) => !bySourceId.has(r.source_id!)).length;
  if (missing)
    console.log(`  note: ${missing.toLocaleString()} stored rows are absent from GBIF's current pages`);

  // ---- resolve every distinct published name the exact match cannot place ----
  const distinct = new Map<string, number>();
  for (const r of dbRows) {
    const n = bySourceId.get(r.source_id);
    if (n?.published) distinct.set(n.published, (distinct.get(n.published) ?? 0) + 1);
  }

  const needed = [...distinct.keys()].filter((n) => !matchLocal(idx, n));
  console.log(
    `Names: ${distinct.size.toLocaleString()} distinct published names, ` +
      `${needed.length} need more than an exact match`,
  );

  const crosswalk: Record<string, CrosswalkEntry> = {};
  const unresolvedWhy = new Map<string, string>();
  let apiAsked = 0;
  let apiFailed = 0;
  let sinceSave = 0;
  for (const name of needed.sort()) {
    const before = Object.keys(taicolCache).length;
    const res = await resolve(name, idx, useApi);
    if (Object.keys(taicolCache).length > before) {
      apiAsked++;
      // Flush as we go. These are hundreds of sequential requests to somebody
      // else's server; losing them to a Ctrl-C at name 240 would mean asking for
      // all of them again.
      if (++sinceSave >= 25) ((saveTaicolCache(), (sinceSave = 0)));
    }
    if (res.taxon) {
      crosswalk[name] = {
        taicol_id: res.taxon.taicol_id,
        scientific_name: res.taxon.scientific_name,
        common_name_zh: res.taxon.common_name_zh,
        via: res.via,
        records: distinct.get(name) ?? 0,
      };
    } else {
      unresolvedWhy.set(name, res.why);
      if (res.why.startsWith("taicol unreachable")) apiFailed++;
    }
  }
  saveTaicolCache();
  if (apiAsked) console.log(`  asked TaiCOL about ${apiAsked} name(s)`);

  const unconfirmed = Object.values(crosswalk).filter((e) =>
    e.via.includes("unconfirmed"),
  ).length;
  const contradicted = [...unresolvedWhy.values()].filter((w) =>
    w.includes("but TaiCOL says"),
  ).length;
  if (unconfirmed)
    console.log(
      `\n  ! ${unconfirmed} crosswalk entr(ies) rest on the local rule alone —\n` +
        `    TaiCOL did not confirm them. Each says so in its \`via\`. Shipping what\n` +
        `    local resolution achieved; re-run when TaiCOL answers.`,
    );
  if (contradicted)
    console.log(
      `\n  ! ${contradicted} name(s) where the local rule and TaiCOL disagree. Neither\n` +
        `    answer is used; they are listed in the CSV for a biologist.`,
    );
  if (apiFailed)
    console.log(
      `\n  ! TaiCOL was unreachable for ${apiFailed} unresolved name(s).`,
    );

  const crosswalkFile: Crosswalk = {
    generated_by: "scripts/remap-gbif-taxa.ts",
    generated_at: new Date().toISOString().slice(0, 10),
    names: Object.fromEntries(
      Object.entries(crosswalk).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  writeFileSync(CROSSWALK_PATH, JSON.stringify(crosswalkFile, null, 2) + "\n");
  console.log(
    `Crosswalk: ${Object.keys(crosswalk).length} names → ${CROSSWALK_PATH.replace(REPO + "/", "")}`,
  );

  // ---- names that match exactly, but a taxon TaiCOL does not place here ------
  //
  // An exact match on the name TaiRON published is the strongest evidence there
  // is, and it outranks the crosswalk, so these records keep the taxon they have.
  // They are still wrong in a way a person can see — /species lists only Taiwanese
  // taxa, so 162 records of a coral snake are counted by /stats and findable
  // nowhere — and the answer is a taxonomic judgement, not a lookup: TaiCOL splits
  // *Buergeria japonica* into two Taiwanese species and nothing here may pick one.
  // So we ask TaiCOL what it thinks, write the answer into the report beside the
  // name, and leave the decision to a biologist.
  const suggestions = new Map<string, string>();
  const abroad = [...distinct.keys()].filter((n) => {
    const m = matchLocal(idx, n);
    return m && !m.is_in_taiwan;
  });
  if (abroad.length) {
    for (const name of abroad.sort()) {
      if (!useApi) continue;
      const v = await askTaicol(name, idx);
      suggestions.set(
        name,
        v.ok
          ? `TaiCOL resolves it to ${v.taicol_id} ${idx.byTaicolId.get(v.taicol_id)?.scientific_name ?? ""} — a biologist should confirm before it is applied`
          : `TaiCOL cannot settle it either: ${v.why}`,
      );
    }
    saveTaicolCache();
    console.log(
      `Abroad: ${abroad.length} published name(s) match a taxon TaiCOL does not record in Taiwan`,
    );
  }

  // ---- what each record should be, under the fixed matcher -------------------
  const live = loadCrosswalk();
  const groups = new Map<string, Group>();
  const taxaById = new Map<number, TaxonRow>();
  for (const t of idx.byTaicolId.values()) taxaById.set(t.id, t);

  for (const r of dbRows) {
    const n = bySourceId.get(r.source_id);
    if (!n) continue;
    const want = matchTaxon(idx, live, n.parts);
    const newId = want.taxon?.id ?? null;
    if (newId === r.taxon_id) continue;

    const key = `${n.published ?? ""}|${r.taxon_id ?? ""}|${newId ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        published: n.published,
        gbifSpecies: n.parts.species ?? null,
        oldTaxon: r.taxon_id != null ? (taxaById.get(r.taxon_id) ?? null) : null,
        newTaxon: want.taxon,
        verbatim: want.verbatim,
        via: want.via,
        sourceIds: [],
        before: new Map(),
        after: new Map(),
        loosened: 0,
        tightened: 0,
      };
      groups.set(key, g);
    }
    g.sourceIds.push(r.source_id);
  }

  const changing = [...groups.values()].reduce((n, g) => n + g.sourceIds.length, 0);
  console.log(`Changes: ${changing.toLocaleString()} records in ${groups.size} groups\n`);
  if (!groups.size)
    console.log(
      "  Nothing to move: this database already agrees with the matcher. The\n" +
        "  report and SQL below will be empty, which is the truth about this\n" +
        "  database and not a record of an earlier run. Keep the artefacts from\n" +
        "  the run that applied.\n",
    );

  // ---- run it for real, inside a transaction, and measure ---------------------
  const ROLLBACK = Symbol("dry run");
  let overallBefore = new Map<string, number>();
  let overallAfter = new Map<string, number>();
  /**
   * Precision as the remap leaves it, per record, measured inside the
   * transaction and kept after the rollback.
   *
   * The unresolved report needs it. A record can both change taxon and still
   * have no Taiwanese taxon afterwards — one that loses its GBIF-`species`
   * match and gains nothing keeps no taxon and is newly blurred — so reading its
   * precision off the pre-remap row would print the state the remap has just
   * left behind.
   */
  const precisionAfter = new Map<string, string>();

  try {
    await sql.begin(async (tx) => {
      await loadRemapTable(tx, groups);

      overallBefore = histogram(
        await tx<{ location_precision: string; n: number }[]>`
          select location_precision, count(*)::int as n
            from reports where source = 'gbif' group by 1`,
      );
      // Per record, not per group: a group shares a taxon, not a direction. See
      // Group.loosened.
      const beforeEach = await tx<
        { source_id: string; location_precision: string }[]
      >`select r.source_id, r.location_precision
          from reports r join remap m on m.source_id = r.source_id
         where r.source = 'gbif'`;

      const res = await tx`
        update reports r
           -- The importer's own invariant, kept: a row with a taxon carries no
           -- verbatim name, a row without one carries the name TaiRON published.
           -- Leaving a string beside a resolved taxon would show it on the record
           -- page as if nobody had identified the animal; dropping it from a row
           -- that loses its taxon would leave the page with nothing to say.
           set taxon_id = m.new_taxon_id,
               verbatim_name = m.verbatim
          from remap m
         where r.source = 'gbif'
           and r.source_id = m.source_id
           and r.taxon_id is distinct from m.new_taxon_id`;
      console.log(`  updated ${res.count.toLocaleString()} rows`);

      overallAfter = histogram(
        await tx<{ location_precision: string; n: number }[]>`
          select location_precision, count(*)::int as n
            from reports where source = 'gbif' group by 1`,
      );
      const afterEach = await tx<
        { source_id: string; location_precision: string }[]
      >`select r.source_id, r.location_precision
          from reports r join remap m on m.source_id = r.source_id
         where r.source = 'gbif'`;

      const was = new Map(beforeEach.map((r) => [r.source_id, r.location_precision]));
      const now = new Map(afterEach.map((r) => [r.source_id, r.location_precision]));
      for (const [id, p] of now) precisionAfter.set(id, p);
      for (const g of groups.values()) {
        for (const id of g.sourceIds) {
          const b = was.get(id);
          const a = now.get(id);
          if (!b || !a) continue;
          bump(g.before, b);
          bump(g.after, a);
          if (disclosure(a) > disclosure(b)) g.loosened++;
          else if (disclosure(a) < disclosure(b)) g.tightened++;
        }
      }

      if (!apply) throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }

  // ---- artefacts -------------------------------------------------------------
  const unresolvedGroups = unresolvedRows(
    dbRows, bySourceId, idx, live, taxaById, unresolvedWhy, suggestions, precisionAfter,
  );
  writeReport(idx, groups, unresolvedGroups);
  writeSql(idx, groups);
  summarise(idx, groups, overallBefore, overallAfter, apply, unresolvedGroups);

  await sql.end();
}

/** Stage the mapping so the UPDATE and both histograms see exactly one set of rows. */
async function loadRemapTable(tx: postgres.TransactionSql, groups: Map<string, Group>) {
  await tx`create temp table remap (
             source_id text primary key,
             new_taxon_id bigint,
             verbatim text,
             grp text not null) on commit drop`;
  const rows = [...groups.entries()].flatMap(([grp, g]) =>
    g.sourceIds.map((source_id) => ({
      source_id,
      new_taxon_id: g.newTaxon?.id ?? null,
      verbatim: g.verbatim,
      grp,
    })),
  );
  for (let i = 0; i < rows.length; i += 2000) {
    const slice = rows.slice(i, i + 2000);
    await tx`insert into remap ${tx(slice, "source_id", "new_taxon_id", "verbatim", "grp")}`;
  }
}

type UnresolvedGroup = {
  name: string;
  taxon: TaxonRow | null;
  n: number;
  before: Map<string, number>;
  after: Map<string, number>;
  why: string;
};

/**
 * Records that have no Taiwanese taxon once the remap has run: the ones the
 * matcher cannot place at all, and the ones left on a taxon TaiCOL does not
 * record here. Both belong in the report — they are the work that remains, and
 * the acceptance criteria are stated in terms of them.
 *
 * Not the same set as "records the remap does not touch". A record can be listed
 * here and still appear as a change above, because losing a wrong taxon is a
 * change and having no right one to gain is what puts it here.
 */
function unresolvedRows(
  dbRows: DbRow[],
  bySourceId: Map<string, CachedName>,
  idx: TaxonIndex,
  live: Map<string, CrosswalkEntry>,
  taxaById: Map<number, TaxonRow>,
  why: Map<string, string>,
  suggestions: Map<string, string>,
  precisionAfter: Map<string, string>,
): UnresolvedGroup[] {
  const out = new Map<string, UnresolvedGroup>();
  for (const r of dbRows) {
    const n = bySourceId.get(r.source_id);
    const want = n
      ? matchTaxon(idx, live, n.parts)
      : { taxon: r.taxon_id != null ? (taxaById.get(r.taxon_id) ?? null) : null, via: "none" as const };

    const stillWrong = !want.taxon || !want.taxon.is_in_taiwan;
    if (!stillWrong) continue;

    const name =
      n?.published ??
      n?.parts.species ??
      n?.parts.scientificName ??
      want.taxon?.scientific_name ??
      "(unnamed)";
    let g = out.get(name);
    if (!g) {
      g = {
        name,
        taxon: want.taxon,
        n: 0,
        before: new Map(),
        after: new Map(),
        why: want.taxon
          ? `the published name matches ${want.taxon.scientific_name}, which TaiCOL does not record in Taiwan. ` +
            (suggestions.get(name) ?? "Not asked about.")
          : (why.get(name) ?? "not identified to species"),
      };
      out.set(name, g);
    }
    g.n++;
    // Both ends, because being unresolved does not mean being untouched: a record
    // that loses a wrong taxon and gains no right one is listed here and is
    // newly blurred, and one column would hide half of that.
    bump(g.before, r.location_precision);
    bump(g.after, precisionAfter.get(r.source_id) ?? r.location_precision);
  }
  return [...out.values()].sort((a, b) => b.n - a.n);
}


/**
 * `loosens` is the one that needs a human: the record becomes easier to locate.
 *
 * One loosened record is enough to label the whole group, even where hundreds of
 * its siblings tighten. A disclosure does not net off against a suppression: the
 * question the label answers is "is there anything here a person must sign off",
 * and the exact counts in both directions travel beside it.
 */
function direction(g: Group): "loosens" | "tightens" | "unchanged" {
  if (g.loosened > 0) return "loosens";
  if (g.tightened > 0) return "tightens";
  return "unchanged";
}

/**
 * A rating that exists, but one rank above the taxon the record now carries.
 *
 * TaiCOL records sensitivity on the species row. A subspecies row under it can
 * be blank, and the obscuring trigger reads only the row it is given — so
 * following the name TaiRON published from *Hipposideros armiger* (重度, blurred
 * to 50 km) down to *H. a. terasensis* (blank) turns 46 blurred bat roosts into
 * exact pins. Nobody decided the bat is safe to map. The rating is simply
 * recorded at the rank above, and the rename walked past it.
 *
 * One hop only, and only from a subspecies: a species whose genus happens to
 * carry a rating is not the same situation, and climbing further would sweep in
 * whole families.
 */
function ratingOneRankUp(idx: TaxonIndex, t: TaxonRow | null): TaxonRow | null {
  if (!t || t.rank !== "Subspecies") return null;
  if (t.sensitivity || t.protected_status) return null;
  const parent = t.parent_taicol_id ? idx.byTaicolId.get(t.parent_taicol_id) : null;
  if (!parent) return null;
  return parent.sensitivity || parent.protected_status ? parent : null;
}

const rating = (t: TaxonRow | null | undefined) =>
  [t?.sensitivity, t?.protected_status].filter(Boolean).join(" / ") || "unrated";

/**
 * Not all loosening is the same kind of thing, and the difference is the whole
 * reason a person reads this report.
 *
 * Most of it replaces migration 0011's blur on a record nobody had identified:
 * nothing said that animal was sensitive, only that nobody knew what it was, and
 * naming it is how that gets answered. That is the intended effect.
 *
 * Two others are not, and they are not each other either:
 *
 *   rank     — the new taxon is a subspecies of a species that carries the
 *              rating. An artefact of where TaiCOL files sensitivity, not a
 *              decision about the animal. These are the ones to look at hardest.
 *   swap     — the old taxon carried a rating the new one does not, and the new
 *              one is not merely a rank below it. The dogs are this: the wolf is
 *              protected II, 犬 is not, and that is the correction working, not
 *              a blur going missing. Worth reading; not worth alarm.
 */
function protectionLost(idx: TaxonIndex, g: Group): string | null {
  const up = ratingOneRankUp(idx, g.newTaxon);
  if (up)
    return (
      `PROTECTION SITS ONE RANK UP: ${up.scientific_name} is rated ${rating(up)}; ` +
      `${g.newTaxon?.scientific_name} under it is unrated, so the blur falls away ` +
      `with the name. Nobody decided this animal is safe to map. Check before applying.`
    );

  const from = g.oldTaxon;
  const to = g.newTaxon;
  if (!from || !to) return null;
  const lost =
    (from.sensitivity && from.sensitivity !== to.sensitivity) ||
    (from.protected_status && from.protected_status !== to.protected_status);
  if (!lost) return null;
  return (
    `RATING CHANGES WITH THE TAXON: it was on ${from.scientific_name} (${rating(from)}), ` +
    `it is now on ${to.scientific_name} (${rating(to)}). Expected where the old taxon ` +
    `was the wrong animal; read it anyway.`
  );
}

/** `coarse_10km 445; exact 12` — the whole histogram, since a group can be mixed. */
function spread(h: Map<string, number>): string {
  return (
    [...PRECISION_ORDER]
      .reverse()
      .filter((p) => h.get(p))
      .map((p) => `${p} ${h.get(p)}`)
      .join("; ") || "—"
  );
}

function writeReport(
  idx: TaxonIndex,
  groups: Map<string, Group>,
  unresolved: UnresolvedGroup[],
) {
  const header = [
    "direction", "records", "records_loosened", "records_tightened",
    "published_name", "gbif_species",
    "old_taxon_id", "old_taicol_id", "old_scientific_name", "old_common_name_zh",
    "new_taxon_id", "new_taicol_id", "new_scientific_name", "new_common_name_zh",
    "precision_before", "precision_after", "resolved_via", "note",
  ];
  const rank = { loosens: 0, tightens: 1, unchanged: 2, unresolved: 3 } as Record<string, number>;

  const lines: { dir: string; n: number; cells: (string | number | null)[] }[] = [
    ...groups.values(),
  ].map((g) => {
    const dir: string = direction(g);
    return {
      dir,
      n: g.sourceIds.length,
      cells: [
        dir, g.sourceIds.length, g.loosened, g.tightened,
        g.published, g.gbifSpecies,
        g.oldTaxon?.id ?? null, g.oldTaxon?.taicol_id ?? null,
        g.oldTaxon?.scientific_name ?? null, g.oldTaxon?.common_name_zh ?? null,
        g.newTaxon?.id ?? null, g.newTaxon?.taicol_id ?? null,
        g.newTaxon?.scientific_name ?? null, g.newTaxon?.common_name_zh ?? null,
        spread(g.before), spread(g.after), g.via,
        dir === "loosens"
          ? (protectionLost(idx, g) ??
             `DISCLOSURE: ${g.loosened} record(s) become easier to locate — 0011 blurred them ` +
               `because nobody had identified them, and this names them. Owner sign-off before production.`)
          : dir === "tightens"
            ? "newly blurred; safe"
            : "",
      ],
    };
  });

  for (const u of unresolved) {
    lines.push({
      dir: "unresolved",
      n: u.n,
      cells: [
        "unresolved", u.n, 0, 0, u.name, null,
        u.taxon?.id ?? null, u.taxon?.taicol_id ?? null,
        u.taxon?.scientific_name ?? null, u.taxon?.common_name_zh ?? null,
        null, null, null, null,
        spread(u.before), spread(u.after), "", u.why,
      ],
    });
  }

  lines.sort((a, b) => rank[a.dir] - rank[b.dir] || b.n - a.n);
  const csv = [header.join(","), ...lines.map((l) => l.cells.map(csvCell).join(","))];
  writeFileSync(REPORT_PATH, csv.join("\n") + "\n");
  console.log(`Report: ${lines.length} rows → ${REPORT_PATH.replace(REPO + "/", "")}`);
}

function writeSql(idx: TaxonIndex, groups: Map<string, Group>) {
  const all = [...groups.values()];
  const loosening = all.filter((g) => direction(g) === "loosens");
  const demoted = loosening
    .filter((g) => ratingOneRankUp(idx, g.newTaxon))
    .sort((a, b) => b.loosened - a.loosened);
  const loosened = all.reduce((n, g) => n + g.loosened, 0);
  const tightened = all.reduce((n, g) => n + g.tightened, 0);

  const out: string[] = [
    "-- Repair the taxon of GBIF-imported records named wrongly by the first import.",
    "-- Generated by scripts/remap-gbif-taxa.ts. Review before running.",
    "--",
    "-- Read scripts/taxon-remap-report.csv first. It is the same change, per group,",
    "-- with the map precision each group has now and the precision it gains.",
    "--",
    `-- ${loosened.toLocaleString()} record(s) across ${loosening.length} group(s) become MORE precise on`,
    "-- the public map, because naming a record replaces migration 0011's conservative",
    "-- 10 km blur with the taxon's own disclosure policy. That is a publication",
    "-- decision. Do not run this until you have read those rows:",
    ...(loosening.length
      ? loosening
          .sort((a, b) => b.loosened - a.loosened)
          .map(
            (g) =>
              `--   ${String(g.loosened).padStart(6)}  ${g.published ?? "?"} → ` +
              `${g.newTaxon?.scientific_name ?? "?"} ${g.newTaxon?.common_name_zh ?? ""}` +
              ` (${spread(g.before)} → ${spread(g.after)})` +
              (ratingOneRankUp(idx, g.newTaxon) ? "  <-- RATING SITS ONE RANK UP" : ""),
          )
      : ["--   (none)"]),
    "--",
    ...(demoted.length
      ? [
          `-- ${demoted.reduce((n, g) => n + g.loosened, 0).toLocaleString()} of those are the second kind, and are not the same decision.`,
          "-- TaiCOL records sensitivity on the species row, so following a published",
          "-- name down to a subspecies row that has none drops the blur with it. Nobody",
          "-- decided these animals are safe to map; the rating simply sits one rank up:",
          ...demoted.map(
            (g) =>
              `--   ${String(g.loosened).padStart(6)}  ${g.oldTaxon?.scientific_name} ` +
              `(${[g.oldTaxon?.sensitivity, g.oldTaxon?.protected_status].filter(Boolean).join(" / ")})` +
              ` → ${g.newTaxon?.scientific_name} ` +
              `(${[g.newTaxon?.sensitivity, g.newTaxon?.protected_status].filter(Boolean).join(" / ") || "unrated"})`,
          ),
          "-- If that is not wanted, delete those statements before running this file;",
          "-- every other group stands on its own.",
          "--",
        ]
      : []),
    `-- ${tightened.toLocaleString()} record(s) become LESS precise. That direction needs no`,
    "-- permission: it hides a pin nobody had decided to show.",
    "--",
    "-- Taxa are looked up by taicol_id, never by the bigserial taxa.id: those ids",
    "-- are assigned at import time and differ between databases.",
    "--",
    "-- The BEFORE trigger on reports re-derives location_public from the new taxon.",
    "-- Never write location_public here.",
    "",
    "begin;",
    "",
  ];

  for (const g of [...groups.values()].sort(
    (a, b) => b.sourceIds.length - a.sourceIds.length,
  )) {
    const dir = direction(g);
    out.push(
      `-- ${g.sourceIds.length} record(s): ${g.published ?? g.gbifSpecies ?? "?"}` +
        ` (GBIF: ${g.gbifSpecies ?? "—"}) ` +
        `${g.oldTaxon ? `${g.oldTaxon.scientific_name} ${g.oldTaxon.common_name_zh ?? ""}` : "no taxon"}` +
        ` → ${g.newTaxon ? `${g.newTaxon.scientific_name} ${g.newTaxon.common_name_zh ?? ""}` : "no taxon"}` +
        `  [${spread(g.before)} → ${spread(g.after)}, ${dir}` +
        (dir === "loosens" ? `: ${g.loosened} looser, ${g.tightened} tighter` : "") +
        `, via ${g.via}]`,
    );
    const lit = (v: string) => `'${v.replaceAll("'", "''")}'`;
    if (g.newTaxon) {
      out.push(
        `update reports set taxon_id = (select id from taxa where taicol_id = ${lit(g.newTaxon.taicol_id)}),`,
        `                   verbatim_name = null`,
        // Without this guard a taicol_id the target database happens not to hold
        // would make the subquery NULL and quietly un-identify every row below.
        ` where exists (select 1 from taxa where taicol_id = ${lit(g.newTaxon.taicol_id)})`,
        `   and source = 'gbif' and source_id in (`,
      );
    } else {
      out.push(
        `update reports set taxon_id = null,`,
        `                   verbatim_name = ${g.verbatim ? lit(g.verbatim) : "null"}`,
        ` where source = 'gbif' and source_id in (`,
      );
    }
    const ids = g.sourceIds.map((s) => `'${s.replaceAll("'", "''")}'`);
    for (let i = 0; i < ids.length; i += 8)
      out.push("   " + ids.slice(i, i + 8).join(", ") + (i + 8 < ids.length ? "," : ""));
    out.push(");", "");
  }

  out.push(
    "-- Sanity: nothing public should be left on the wolf, and the ferret-badger",
    "-- should be on a taxon the species directory lists.",
    "select count(*) as wolves_remaining from reports_public where taxon_id =",
    "  (select id from taxa where taicol_id = 't0097489');",
    "select count(*) as records_on_non_taiwan_taxa from reports r",
    "  join taxa t on t.id = r.taxon_id where t.is_in_taiwan is not true;",
    "",
    "commit;",
    "",
  );
  writeFileSync(SQL_PATH, out.join("\n"));
  console.log(`SQL:    ${SQL_PATH.replace(REPO + "/", "")}`);
}

function summarise(
  idx: TaxonIndex,
  groups: Map<string, Group>,
  before: Map<string, number>,
  after: Map<string, number>,
  applied: boolean,
  unresolved: UnresolvedGroup[],
) {
  const all = [...groups.values()];
  const totalLoosened = all.reduce((n, g) => n + g.loosened, 0);
  const totalTightened = all.reduce((n, g) => n + g.tightened, 0);
  const totalMoved = all.reduce((n, g) => n + g.sourceIds.length, 0);

  const loosens = all
    .filter((g) => g.loosened > 0)
    .sort((a, b) => b.loosened - a.loosened);
  const demoted = loosens.filter((g) => ratingOneRankUp(idx, g.newTaxon));

  console.log(`
  ── THE LOOSENING — needs the owner's sign-off ────────────────────────────
  ${totalLoosened.toLocaleString()} record(s) across ${loosens.length} taxon change(s) become MORE precise on the
  public map. Counted one record at a time, not by each group's commonest
  precision: a group shares a taxon, not a direction.`);
  for (const g of loosens.slice(0, 40))
    console.log(
      `    ${String(g.loosened).padStart(6)}  ${(g.published ?? "?").padEnd(34)} → ` +
        `${g.newTaxon?.scientific_name ?? "?"} ${g.newTaxon?.common_name_zh ?? ""}`.padEnd(40) +
        `${spread(g.before)} → ${spread(g.after)}` +
        (ratingOneRankUp(idx, g.newTaxon) ? "   <-- rating one rank up" : ""),
    );
  if (loosens.length > 40)
    console.log(
      `    … and ${loosens.length - 40} more, every one of them in the CSV.`,
    );

  if (demoted.length)
    console.log(`
  ── Of those, the ones that are not merely "now identified" ───────────────
  ${demoted.reduce((n, g) => n + g.loosened, 0).toLocaleString()} record(s) lose a blur their old taxon carried and their new one does
  not. TaiCOL rates sensitivity on the species row; a subspecies row can be
  blank, so following the published name down a rank drops the rating with it.
  Nobody decided these are safe to map.
${demoted
  .map(
    (g) =>
      `    ${String(g.loosened).padStart(6)}  ${g.oldTaxon?.scientific_name} ` +
      `(${[g.oldTaxon?.sensitivity, g.oldTaxon?.protected_status].filter(Boolean).join(" / ")})` +
      ` → ${g.newTaxon?.scientific_name} ` +
      `(${[g.newTaxon?.sensitivity, g.newTaxon?.protected_status].filter(Boolean).join(" / ") || "unrated"})` +
      `   ${spread(g.before)} → ${spread(g.after)}`,
  )
  .join("\n")}`);

  console.log(`
  ── The safe direction ────────────────────────────────────────────────────
  ${totalTightened.toLocaleString()} record(s) become LESS precise (newly blurred); no permission needed.
  ${(totalMoved - totalLoosened - totalTightened).toLocaleString()} record(s) change taxon with no change of precision.

  ── Still not placed ──────────────────────────────────────────────────────
  ${unresolved.reduce((n, u) => n + u.n, 0).toLocaleString()} record(s) under ${unresolved.length} name(s) have no Taiwanese taxon afterwards.
  ${unresolved
    .filter((u) => u.taxon && !u.taxon.is_in_taiwan)
    .reduce((n, u) => n + u.n, 0)
    .toLocaleString()} of those sit on a taxon TaiCOL does not record in Taiwan; the CSV
  names each one and says what TaiCOL makes of it. The rest were never
  identified to species by anyone, and 0011 keeps them blurred.

  ── Precision across all imported records ─────────────────────────────────
                   before     after
    ${renderHistogram(before, after)}

  ${applied ? "APPLIED to this database." : "DRY RUN — this database is unchanged. Pass --apply to write."}
  Production is untouched either way: hand the owner scripts/taxon-remap.sql.
`);
}

main().catch(async (err) => {
  console.error("\nremap failed:\n", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
