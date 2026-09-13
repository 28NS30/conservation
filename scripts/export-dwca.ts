/**
 * Export our own records as a Darwin Core Archive, for publication to GBIF.
 *
 *   npm run export:dwca                 # -> data/export/dwca/
 *   npm run export:dwca -- --out /tmp/x
 *   npm run export:dwca -- --include-unidentified
 *
 * This is the reciprocity half of the project. The map was seeded from GBIF's
 * open data; publishing our own observations back is what makes this a
 * contribution to the commons rather than a private silo, and it is what makes
 * the dataset citable by actual researchers.
 *
 * THE MOST IMPORTANT RULE HERE: only records we originated are exported.
 *
 * `reports` holds ~46k TaiRON records imported *from* GBIF. Publishing those back
 * would create duplicate occurrences in GBIF under the wrong publisher, breaking
 * their deduplication and misattributing 路殺社's decade of work to us. So the
 * query filters `source = 'user'`, and that filter is not negotiable — see the
 * assertion in the export itself, which refuses to write an archive containing a
 * record it did not originate.
 *
 * Coordinates come from `reports_public`, i.e. already obscured for sensitive
 * taxa, and the obscuring is declared honestly to consumers through
 * `coordinateUncertaintyInMeters`, `dataGeneralizations` and `informationWithheld`
 * rather than silently shipping a fuzzed point as if it were exact. Suppressed
 * records are omitted altogether.
 *
 * Output is a directory, not a zip: `meta.xml`, `eml.xml`, `occurrence.txt`. Zip
 * it with `cd data/export/dwca && zip -r ../dwca.zip .` when uploading to an IPT.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ *
 * Dataset metadata. Edit before the first real publication.
 * ------------------------------------------------------------------ */

const DATASET = {
  title: "Project FormosaWatch (福爾摩沙守望計畫) — citizen science observations from Taiwan",
  shortName: "formosawatch-tw-occurrences",
  /** Placeholder until the project registers a DOI/UUID with GBIF. */
  id: "formosawatch-tw",
  language: "zh-Hant",
  abstract:
    "Wildlife observations contributed by the public through Project FormosaWatch (福爾摩沙守望計畫), Taiwan: " +
    "roadkill, invasive species, injured animals, and general sightings. Species identifications " +
    "are either chosen by the reporter from the classifier's suggestions for their own photograph, " +
    "assigned by a machine-learning classifier above a measured confidence threshold, or verified by " +
    "a moderator; the identificationVerificationStatus field distinguishes these, and only the last " +
    "involves a second observer. Locations of species rated sensitive by the Catalogue of Life in " +
    "Taiwan (TaiCOL) are generalised, and coordinateUncertaintyInMeters reflects that.",
  /** CC BY 4.0: matches what we ask contributors to agree to, and what we received. */
  license: "http://creativecommons.org/licenses/by/4.0/legalcode",
  licenseLabel: "CC BY 4.0",
  homepage: "https://example.org",
  contactEmail: "",
};

/* ------------------------------------------------------------------ *
 * Darwin Core mapping
 * ------------------------------------------------------------------ */

/**
 * Column order here defines the archive. `meta.xml` is generated from this same
 * list, so the two cannot drift — a mismatched meta.xml is the single most common
 * way a DwC-A is rejected, and it fails silently as misaligned columns.
 */
const TERMS = [
  "occurrenceID",
  "basisOfRecord",
  "eventDate",
  "year",
  "month",
  "day",
  "countryCode",
  "decimalLatitude",
  "decimalLongitude",
  "geodeticDatum",
  "coordinateUncertaintyInMeters",
  "scientificName",
  "taxonID",
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "taxonRank",
  "vernacularName",
  "identificationVerificationStatus",
  "occurrenceRemarks",
  "occurrenceStatus",
  "dataGeneralizations",
  "informationWithheld",
  "license",
  "rightsHolder",
  "datasetName",
] as const;

/** Darwin Core term URIs, in the same order. */
const TERM_URI: Record<string, string> = {
  basisOfRecord: "http://rs.tdwg.org/dwc/terms/basisOfRecord",
  eventDate: "http://rs.tdwg.org/dwc/terms/eventDate",
  year: "http://rs.tdwg.org/dwc/terms/year",
  month: "http://rs.tdwg.org/dwc/terms/month",
  day: "http://rs.tdwg.org/dwc/terms/day",
  countryCode: "http://rs.tdwg.org/dwc/terms/countryCode",
  decimalLatitude: "http://rs.tdwg.org/dwc/terms/decimalLatitude",
  decimalLongitude: "http://rs.tdwg.org/dwc/terms/decimalLongitude",
  geodeticDatum: "http://rs.tdwg.org/dwc/terms/geodeticDatum",
  coordinateUncertaintyInMeters: "http://rs.tdwg.org/dwc/terms/coordinateUncertaintyInMeters",
  scientificName: "http://rs.tdwg.org/dwc/terms/scientificName",
  taxonID: "http://rs.tdwg.org/dwc/terms/taxonID",
  kingdom: "http://rs.tdwg.org/dwc/terms/kingdom",
  phylum: "http://rs.tdwg.org/dwc/terms/phylum",
  class: "http://rs.tdwg.org/dwc/terms/class",
  order: "http://rs.tdwg.org/dwc/terms/order",
  family: "http://rs.tdwg.org/dwc/terms/family",
  genus: "http://rs.tdwg.org/dwc/terms/genus",
  taxonRank: "http://rs.tdwg.org/dwc/terms/taxonRank",
  vernacularName: "http://rs.tdwg.org/dwc/terms/vernacularName",
  identificationVerificationStatus:
    "http://rs.tdwg.org/dwc/terms/identificationVerificationStatus",
  occurrenceRemarks: "http://rs.tdwg.org/dwc/terms/occurrenceRemarks",
  occurrenceStatus: "http://rs.tdwg.org/dwc/terms/occurrenceStatus",
  dataGeneralizations: "http://rs.tdwg.org/dwc/terms/dataGeneralizations",
  informationWithheld: "http://rs.tdwg.org/dwc/terms/informationWithheld",
  license: "http://purl.org/dc/terms/license",
  rightsHolder: "http://purl.org/dc/terms/rightsHolder",
  datasetName: "http://rs.tdwg.org/dwc/terms/datasetName",
};

/** Uncertainty we declare for each precision level, in metres. */
const UNCERTAINTY: Record<string, number> = {
  // Phone GPS under tree cover, honestly stated. Claiming better would be a lie
  // that propagates into every downstream analysis.
  exact: 30,
  coarse_10km: 10_000,
  coarse_50km: 50_000,
};

/**
 * How the identification was arrived at, in GBIF's controlled-ish vocabulary.
 *
 * `user` is NOT "verified". It is the reporter agreeing with one of the
 * classifier's own suggestions for their own photograph — one person, no second
 * opinion. "Verified by" is a claim about a second party, and on that path there
 * is no second party; a downstream modeller filtering for verified records would
 * have been handed self-assertions. Only `expert` involves someone other than
 * the reporter, and only that one says verified.
 */
const VERIFICATION: Record<string, string> = {
  user: "Unverified — reporter's own identification",
  expert: "Verified by moderator",
  ai: "Unverified — machine identification above measured confidence threshold",
  imported: "Unverified",
};

type Row = {
  id: string;
  category: string;
  /** postgres.js parses timestamptz into a Date, not a string. */
  observed_at: Date;
  notes: string | null;
  location_precision: string;
  is_obscured: boolean;
  taxon_source: string | null;
  lat: number | null;
  lng: number | null;
  scientific_name: string | null;
  taxon_id: number | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  rank: string | null;
  common_name_zh: string | null;
  license: string | null;
  rights_holder: string | null;
  source: string;
};

/**
 * Escape a value for a tab-delimited DwC file.
 *
 * Tabs, newlines and carriage returns inside free-text notes would otherwise
 * shift every subsequent column of that row, and because the archive has no
 * quoting, a single pasted newline silently corrupts the file from that point on.
 */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[\t\r\n]+/g, " ").trim();
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function metaXml(): string {
  // Field indices are positional and must match TERMS exactly. index 0 is the
  // record id (occurrenceID), which is declared separately AND as a field.
  const fields = TERMS.slice(1)
    .map((t, i) => `      <field index="${i + 1}" term="${TERM_URI[t]}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/">
  <core encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n"
        fieldsEnclosedBy="" ignoreHeaderLines="1"
        rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
    <files><location>occurrence.txt</location></files>
    <id index="0"/>
${fields}
  </core>
</archive>
`;
}

function emlXml(count: number, first: Date | null, last: Date | null): string {
  const now = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="https://eml.ecoinformatics.org/eml-2.2.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         packageId="${DATASET.id}/${now}" system="conservation-tw"
         scope="system" xml:lang="zh">
  <dataset>
    <title xml:lang="zh">${xmlEscape(DATASET.title)}</title>
    <pubDate>${now}</pubDate>
    <language>${DATASET.language}</language>
    <abstract><para>${xmlEscape(DATASET.abstract)}</para></abstract>
    <intellectualRights>
      <para>This work is licensed under a
        <ulink url="${DATASET.license}"><citetitle>${DATASET.licenseLabel}</citetitle></ulink>
        License.</para>
    </intellectualRights>
    <coverage>
      <geographicCoverage>
        <geographicDescription>Taiwan, including Penghu, Kinmen and Matsu</geographicDescription>
        <boundingCoordinates>
          <westBoundingCoordinate>118.0</westBoundingCoordinate>
          <eastBoundingCoordinate>122.5</eastBoundingCoordinate>
          <northBoundingCoordinate>26.5</northBoundingCoordinate>
          <southBoundingCoordinate>21.5</southBoundingCoordinate>
        </boundingCoordinates>
      </geographicCoverage>
      ${
        first && last
          ? `<temporalCoverage><rangeOfDates>
        <beginDate><calendarDate>${first.toISOString().slice(0, 10)}</calendarDate></beginDate>
        <endDate><calendarDate>${last.toISOString().slice(0, 10)}</calendarDate></endDate>
      </rangeOfDates></temporalCoverage>`
          : ""
      }
    </coverage>
    <purpose><para>${count.toLocaleString()} occurrence records contributed by the public.</para></purpose>
  </dataset>
</eml:eml>
`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, "data", "export", "dwca");
  const includeUnidentified = args.includes("--include-unidentified");

  // reports_public already excludes unpublished records and applies obscuring.
  // Joining back to `reports` is only to read `source`, which the public view
  // does expose — the filter below is the whole point of this export.
  const rows = await sql<Row[]>`
    select r.id::text, r.category, r.observed_at, r.notes,
           r.location_precision, r.is_obscured, r.taxon_source, r.source,
           r.license, r.rights_holder,
           st_y(r.location_public::geometry) as lat,
           st_x(r.location_public::geometry) as lng,
           t.scientific_name, t.id as taxon_id, t.kingdom, t.phylum, t.class,
           t."order", t.family, t.genus, t.rank, t.common_name_zh
      from reports_public r
      left join taxa t on t.id = r.taxon_id
     where r.source = 'user'
       and r.location_precision <> 'suppressed'
       and (${includeUnidentified} or r.taxon_id is not null)
     order by r.observed_at`;

  // Belt and braces. If the query above is ever edited carelessly, this stops an
  // archive containing 路殺社's records from being uploaded under our name.
  const foreign = rows.filter((r) => r.source !== "user");
  if (foreign.length) {
    throw new Error(
      `refusing to export ${foreign.length} record(s) not originated here ` +
        `(sources: ${[...new Set(foreign.map((r) => r.source))].join(", ")}). ` +
        `Publishing imported records back to GBIF would duplicate them and ` +
        `misattribute another publisher's work.`,
    );
  }

  await mkdir(outDir, { recursive: true });

  const lines = [TERMS.join("\t")];
  for (const r of rows) {
    const d = new Date(r.observed_at);
    const generalisation = r.is_obscured
      ? `Coordinates generalised to approximately ${
          UNCERTAINTY[r.location_precision] / 1000
        } km because this taxon is rated sensitive in TaiCOL`
      : "";

    const values: Record<string, unknown> = {
      // Stable and opaque. A UUID means republishing after an edit updates the
      // existing GBIF occurrence instead of creating a duplicate.
      occurrenceID: r.id,
      basisOfRecord: "HumanObservation",
      eventDate: r.observed_at ? r.observed_at.toISOString() : "",
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      countryCode: "TW",
      decimalLatitude: r.lat?.toFixed(6),
      decimalLongitude: r.lng?.toFixed(6),
      geodeticDatum: "EPSG:4326",
      coordinateUncertaintyInMeters: UNCERTAINTY[r.location_precision] ?? "",
      scientificName: r.scientific_name,
      taxonID: r.taxon_id ? `TaiCOL:${r.taxon_id}` : "",
      kingdom: r.kingdom,
      phylum: r.phylum,
      class: r.class,
      order: r.order,
      family: r.family,
      genus: r.genus,
      taxonRank: r.rank?.toLowerCase(),
      vernacularName: r.common_name_zh,
      identificationVerificationStatus: VERIFICATION[r.taxon_source ?? ""] ?? "Unverified",
      // The reporter's own note plus the report category, which is real
      // ecological signal: "roadkill" is how the animal was encountered.
      occurrenceRemarks: [r.category, r.notes].filter(Boolean).join("; "),
      occurrenceStatus: "present",
      dataGeneralizations: generalisation,
      informationWithheld: r.is_obscured ? "Exact coordinates withheld for a sensitive taxon" : "",
      license: r.license ?? DATASET.license,
      rightsHolder: r.rights_holder ?? DATASET.title,
      datasetName: DATASET.title,
    };
    lines.push(TERMS.map((t) => cell(values[t])).join("\t"));
  }

  await writeFile(join(outDir, "occurrence.txt"), lines.join("\n") + "\n", "utf8");
  await writeFile(join(outDir, "meta.xml"), metaXml(), "utf8");
  await writeFile(
    join(outDir, "eml.xml"),
    emlXml(rows.length, rows[0]?.observed_at ?? null, rows.at(-1)?.observed_at ?? null),
    "utf8",
  );

  const obscured = rows.filter((r) => r.is_obscured).length;
  console.log(`Darwin Core Archive -> ${outDir}`);
  console.log(`  ${rows.length.toLocaleString()} occurrence records (source='user' only)`);
  console.log(`  ${obscured.toLocaleString()} with generalised coordinates, declared as such`);
  if (rows.length === 0) {
    console.log(
      "\n  Nothing to publish yet: every record currently in the database was\n" +
        "  imported from GBIF, and those are deliberately excluded. This archive\n" +
        "  becomes meaningful once the site has its own submissions.",
    );
  } else {
    console.log(`\n  Zip it:  cd ${outDir} && zip -r ../dwca.zip .`);
  }
  await sql.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await sql.end();
  process.exit(1);
});
