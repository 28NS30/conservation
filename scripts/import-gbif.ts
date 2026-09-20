/**
 * Seed the map from GBIF open data so it isn't empty on day one.
 *
 *   npm run import:gbif              # TaiRON roadkill dataset (~46k records)
 *   npm run import:gbif -- --all     # ...plus country-wide Taiwan occurrences
 *   npm run import:gbif -- --limit 5000
 *
 * Source: https://api.gbif.org/v1/occurrence/search — public, keyless.
 *
 * Idempotent: rows carry (source='gbif', source_id=occurrenceID) and the partial
 * unique index makes re-runs insert nothing.
 *
 * Licensing: GBIF records carry per-record licences (CC0 / CC-BY / CC-BY-NC).
 * CC-BY *requires* attribution, so `license` and `rights_holder` are stored per
 * row and surfaced on the attribution page.
 */
import { sql, fetchJson, progress } from "./db.ts";
import {
  loadCrosswalk,
  loadTaxonIndex,
  matchTaxon,
  type CrosswalkEntry,
  type TaxonIndex,
} from "./taxon-names.ts";
import { isInTaiwanBounds } from "@conservation/shared";

const API = "https://api.gbif.org/v1/occurrence/search";
const PAGE = 300;
/** GBIF refuses offsets beyond this; past it you need the async Download API. */
const MAX_OFFSET = 100_000;
/** Points fuzzier than this would smear the heatmap. */
const MAX_UNCERTAINTY_M = 5_000;

const TAIRON_DATASET = "db09684b-0fd1-431e-b5fa-4c1532fbdb14";

type Occurrence = {
  occurrenceID?: string;
  gbifID?: string | number;
  species?: string;
  scientificName?: string;
  // The Darwin Core atoms of the name the publisher actually wrote. GBIF's
  // `species` is GBIF's own answer, arrived at by re-filing the record under its
  // backbone taxonomy; these three survive that untouched. See taxon-names.ts.
  genericName?: string;
  specificEpithet?: string;
  infraspecificEpithet?: string;
  decimalLatitude?: number;
  decimalLongitude?: number;
  eventDate?: string;
  year?: number;
  coordinateUncertaintyInMeters?: number | null;
  license?: string;
  rightsHolder?: string;
  datasetKey?: string;
};

type SearchPage = {
  count: number;
  results: Occurrence[];
  endOfRecords: boolean;
};

/**
 * Who to credit, for a dataset that does not credit itself per record.
 *
 * CC BY requires attribution by name, but GBIF's occurrence search only carries
 * `rightsHolder` when the publisher chose to set it on each occurrence — and
 * TaiRON, the dataset this project is seeded from, does not. The result was
 * 46,402 CC BY records stored with a null rights holder, which /attribution
 * faithfully rendered as "unspecified".
 *
 * Attribution for GBIF-mediated data belongs at the dataset level anyway, so
 * resolve the dataset's publishing organisation once and use it as the fallback.
 * Cached per run: two extra requests per dataset, not per page.
 */
const rightsHolderCache = new Map<string, string | null>();

async function datasetRightsHolder(datasetKey: string): Promise<string | null> {
  const cached = rightsHolderCache.get(datasetKey);
  if (cached !== undefined) return cached;

  let holder: string | null = null;
  try {
    const ds = await fetchJson<{
      rights?: string;
      publishingOrganizationKey?: string;
    }>(`https://api.gbif.org/v1/dataset/${datasetKey}`);

    // An explicit `rights` statement outranks the organisation name.
    if (ds.rights?.trim()) {
      holder = ds.rights.trim();
    } else if (ds.publishingOrganizationKey) {
      const org = await fetchJson<{ title?: string }>(
        `https://api.gbif.org/v1/organization/${ds.publishingOrganizationKey}`,
      );
      holder = org.title?.trim() || null;
    }
  } catch (err) {
    // Never fail an import over attribution metadata — the licence URL is still
    // stored per record, and 0007 shows a backfill is straightforward.
    console.warn(
      `  ! could not resolve rights holder for ${datasetKey}: ${err}`,
    );
  }

  rightsHolderCache.set(datasetKey, holder);
  if (holder) console.log(`  attribution: ${datasetKey} → ${holder}`);
  return holder;
}

type Row = {
  category: string;
  lng: number;
  lat: number;
  observed_at: string;
  taxon_id: number | null;
  verbatim_name: string | null;
  source_id: string;
  license: string | null;
  rights_holder: string | null;
};

/** GBIF eventDate may be a range ("2017-01-02/2017-01-03") or absent. */
function parseObserved(o: Occurrence): string | null {
  const raw = o.eventDate?.split("/")[0];
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (o.year && o.year > 1900 && o.year <= new Date().getFullYear()) {
    return new Date(Date.UTC(o.year, 0, 1)).toISOString();
  }
  return null;
}

/** Offsets whose page could not be fetched even after retries. */
const failedOffsets: number[] = [];

const stats = {
  fetched: 0,
  inserted: 0,
  skippedNoCoord: 0,
  skippedOutOfBounds: 0,
  skippedFuzzy: 0,
  skippedNoDate: 0,
  skippedNoId: 0,
  matchedTaxon: 0,
  unmatchedTaxon: 0,
  /** Which matcher rule answered, so a run says how it got its names. */
  viaPublished: 0,
  viaCrosswalk: 0,
  viaSpecies: 0,
};

function toRow(
  o: Occurrence,
  category: string,
  taxonIdx: TaxonIndex,
  crosswalk: Map<string, CrosswalkEntry>,
  fallbackRightsHolder: string | null,
): Row | null {
  const lat = o.decimalLatitude,
    lng = o.decimalLongitude;
  if (typeof lat !== "number" || typeof lng !== "number") {
    stats.skippedNoCoord++;
    return null;
  }
  if (!isInTaiwanBounds(lng, lat)) {
    stats.skippedOutOfBounds++;
    return null;
  }

  const unc = o.coordinateUncertaintyInMeters;
  // Only reject when uncertainty is actually reported; most TaiRON rows omit it.
  if (typeof unc === "number" && unc > MAX_UNCERTAINTY_M) {
    stats.skippedFuzzy++;
    return null;
  }

  const observed = parseObserved(o);
  if (!observed) {
    stats.skippedNoDate++;
    return null;
  }

  const sourceId =
    o.occurrenceID ?? (o.gbifID != null ? String(o.gbifID) : undefined);
  if (!sourceId) {
    stats.skippedNoId++;
    return null;
  }

  // Four rules, in order: the published name against local taxa, the committed
  // crosswalk, GBIF's `species` when that taxon is in Taiwan, then nothing. See
  // taxon-names.ts for why `species` alone was never enough.
  const m = matchTaxon(taxonIdx, crosswalk, o);
  if (m.taxon) {
    stats.matchedTaxon++;
    if (m.via === "published") stats.viaPublished++;
    else if (m.via === "crosswalk") stats.viaCrosswalk++;
    else stats.viaSpecies++;
  } else if (m.verbatim) stats.unmatchedTaxon++;

  return {
    category,
    lng,
    lat,
    observed_at: observed,
    taxon_id: m.taxon?.id ?? null,
    verbatim_name: m.verbatim,
    // Namespace by dataset: occurrenceID is only unique within a dataset.
    source_id: `${o.datasetKey ?? "gbif"}:${sourceId}`,
    license: o.license ?? null,
    // Per-occurrence first; the dataset's publisher when the record is silent.
    rights_holder: o.rightsHolder ?? fallbackRightsHolder,
  };
}

async function insertBatch(rows: Row[]): Promise<number> {
  if (!rows.length) return 0;
  // json_to_recordset keeps this to one round trip while still letting each row
  // build its own PostGIS point. The BEFORE trigger overwrites location_public
  // with the correct precision for the matched taxon.
  const res = await sql`
    insert into reports (
      category, location, location_public, observed_at,
      taxon_id, taxon_source, verbatim_name, status, source, source_id, license, rights_holder
    )
    select r.category,
           st_setsrid(st_makepoint(r.lng, r.lat), 4326)::geography,
           st_setsrid(st_makepoint(r.lng, r.lat), 4326)::geography,
           r.observed_at, r.taxon_id, 'imported', r.verbatim_name,
           'published', 'gbif', r.source_id, r.license, r.rights_holder
      -- sql.json() types the parameter as json. Passing a pre-stringified value
      -- instead makes postgres.js send it as a JSON *string scalar*, and
      -- json_to_recordset rejects that.
      from json_to_recordset(${sql.json(rows)}::json) as r(
             category text, lng double precision, lat double precision,
             observed_at timestamptz, taxon_id bigint, verbatim_name text,
             source_id text, license text, rights_holder text)
    on conflict (source, source_id) where source_id is not null do nothing`;
  return res.count;
}

/**
 * Where to resume from. GBIF pages are stably ordered for a fixed dataset query,
 * and inserts are idempotent, so restarting at the number of rows already stored
 * for this source avoids re-walking pages that would insert nothing. That matters:
 * GBIF is frequently slow enough that a wasted page costs tens of seconds.
 *
 * Any overlap is harmless and any gap is filled by re-running with --restart.
 */
async function resumeOffset(sourcePrefix: string): Promise<number> {
  const [row] = await sql<{ n: string }[]>`
    select count(*)::text as n from reports
     where source = 'gbif' and source_id like ${sourcePrefix + ":%"}`;
  return Math.floor(Number(row.n) / PAGE) * PAGE;
}

async function importQuery(
  label: string,
  params: string,
  category: string,
  cap: number,
  taxonIdx: TaxonIndex,
  crosswalk: Map<string, CrosswalkEntry>,
  startOffset: number,
) {
  const base = `${API}?${params}&hasCoordinate=true&hasGeospatialIssue=false&limit=${PAGE}`;
  const first = await fetchJson<SearchPage>(`${base}&offset=${startOffset}`);
  const total = Math.min(first.count, cap, MAX_OFFSET);
  console.log(
    `\n${label}: ${first.count.toLocaleString()} records available, importing up to ${total.toLocaleString()}`,
  );
  if (startOffset > 0)
    console.log(
      `  resuming at offset ${startOffset.toLocaleString()} (use --restart to start over)`,
    );
  if (first.count > MAX_OFFSET && cap > MAX_OFFSET) {
    console.log(
      `  note: GBIF caps paging at ${MAX_OFFSET.toLocaleString()}; use the async Download API for the full set.`,
    );
  }

  // A single failed page must not abandon a 150-page run. Record it, carry on,
  // and report at the end — re-running is idempotent, so the gaps can be refilled.
  for (let offset = startOffset; offset < total; offset += PAGE) {
    let page: SearchPage | null = offset === startOffset ? first : null;

    if (page === null) {
      try {
        page = await fetchJson<SearchPage>(`${base}&offset=${offset}`);
      } catch (err) {
        failedOffsets.push(offset);
        process.stdout.write(
          `\n  ! offset ${offset} failed after retries (${(err as Error).message}) — continuing\n`,
        );
        continue;
      }
    }

    stats.fetched += page.results.length;
    const rows: Row[] = [];
    for (const o of page.results) {
      const fallback = o.datasetKey
        ? await datasetRightsHolder(o.datasetKey)
        : null;
      const row = toRow(o, category, taxonIdx, crosswalk, fallback);
      if (row) rows.push(row);
    }
    stats.inserted += await insertBatch(rows);
    progress(Math.min(offset + PAGE, total), total, label);

    if (page.endOfRecords) break;
    // Small breather; sustained tight paging is what triggers GBIF resets.
    await new Promise((r) => setTimeout(r, 120));
  }
  progress(total, total, label);
}

async function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes("--all");
  const limIdx = argv.indexOf("--limit");
  const cap = limIdx >= 0 ? Number(argv[limIdx + 1]) : Infinity;

  const taxonIdx = await loadTaxonIndex(sql);
  if (taxonIdx.byName.size === 0) {
    console.error(
      "`taxa` is empty — run `npm run import:taicol` first so records can be matched to species.",
    );
    process.exit(1);
  }
  const crosswalk = loadCrosswalk();
  console.log(
    `Taxon index: ${taxonIdx.byName.size.toLocaleString()} names, ` +
      `crosswalk: ${crosswalk.size.toLocaleString()} published names`,
  );
  if (crosswalk.size === 0)
    console.log(
      "  note: scripts/taxon-crosswalk.json is missing — names TaiCOL and GBIF\n" +
        "        disagree about will not match. Rebuild it with remap-gbif-taxa.ts.",
    );

  const restart = argv.includes("--restart");
  const offIdx = argv.indexOf("--offset");
  const explicitOffset = offIdx >= 0 ? Number(argv[offIdx + 1]) : null;

  const roadkillStart =
    explicitOffset ?? (restart ? 0 : await resumeOffset(TAIRON_DATASET));

  await importQuery(
    "TaiRON roadkill",
    `datasetKey=${TAIRON_DATASET}`,
    "roadkill",
    cap,
    taxonIdx,
    crosswalk,
    roadkillStart,
  );

  if (all) {
    await importQuery(
      "Taiwan occurrences",
      `country=TW&datasetKey=!${TAIRON_DATASET}`,
      "sighting",
      Math.min(cap, 60_000),
      taxonIdx,
      crosswalk,
      0,
    );
  }

  console.log(`
  fetched            ${stats.fetched.toLocaleString()}
  inserted           ${stats.inserted.toLocaleString()}
  taxon matched      ${stats.matchedTaxon.toLocaleString()}
    published name   ${stats.viaPublished.toLocaleString()}
    crosswalk        ${stats.viaCrosswalk.toLocaleString()}
    GBIF species     ${stats.viaSpecies.toLocaleString()}
  taxon unmatched    ${stats.unmatchedTaxon.toLocaleString()}
  skipped: no coord  ${stats.skippedNoCoord.toLocaleString()}
           off-map   ${stats.skippedOutOfBounds.toLocaleString()}
           too fuzzy ${stats.skippedFuzzy.toLocaleString()}
           no date   ${stats.skippedNoDate.toLocaleString()}
           no id     ${stats.skippedNoId.toLocaleString()}`);

  if (failedOffsets.length) {
    console.log(`
  ${failedOffsets.length} page(s) failed and were skipped: offsets ${failedOffsets.slice(0, 10).join(", ")}${failedOffsets.length > 10 ? " …" : ""}

  A plain re-run will NOT fill these gaps. Resume position is derived from the
  number of rows already stored, so it lands past them. Backfill from the first
  failed offset instead — everything already imported re-inserts as a no-op:

    npm run import:gbif -- --offset ${Math.min(...failedOffsets)}`);
  }

  const [p] = await sql<{ obscured: string; suppressed: string }[]>`
    select count(*) filter (where is_obscured)                          as obscured,
           count(*) filter (where location_precision = 'suppressed')    as suppressed
      from reports`;
  console.log(
    `  obscured for sensitivity: ${Number(p.obscured).toLocaleString()} (${Number(p.suppressed).toLocaleString()} fully withheld)\n`,
  );

  await sql.end();
}

main().catch(async (err) => {
  console.error("\nGBIF import failed:\n", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
