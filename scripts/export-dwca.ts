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
 * A record goes out under the licence its contributor granted, or not at all,
 * and without its free-text notes. Both rules, and why, are in
 * dwc-occurrences.ts.
 *
 * Output is a directory, not a zip: `meta.xml`, `eml.xml`, `occurrence.txt`. Zip
 * it with `cd data/export/dwca && zip -r ../dwca.zip .` when uploading to an IPT.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db.ts";
import { TERMS, selectOccurrences, toOccurrence } from "./dwc-occurrences.ts";

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
  /**
   * The licence the DATASET is published under — the EML's intellectualRights
   * — and nothing more. It is not a licence for any record in it. The report
   * form does not yet ask contributors for one, so no user record has one to
   * give, and a record is exported only under the licence it carries itself
   * (dwc-occurrences.ts). Until contributors are asked, that is none of them.
   */
  license: "http://creativecommons.org/licenses/by/4.0/legalcode",
  licenseLabel: "CC BY 4.0",
  homepage: "https://example.org",
  contactEmail: "",
};

/* ------------------------------------------------------------------ *
 * Darwin Core mapping: which records, and what each says, is in
 * dwc-occurrences.ts. This file writes the archive around them.
 * ------------------------------------------------------------------ */

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
  vitality: "http://rs.tdwg.org/dwc/terms/vitality",
  establishmentMeans: "http://rs.tdwg.org/dwc/terms/establishmentMeans",
  degreeOfEstablishment: "http://rs.tdwg.org/dwc/terms/degreeOfEstablishment",
  dataGeneralizations: "http://rs.tdwg.org/dwc/terms/dataGeneralizations",
  informationWithheld: "http://rs.tdwg.org/dwc/terms/informationWithheld",
  license: "http://purl.org/dc/terms/license",
  rightsHolder: "http://purl.org/dc/terms/rightsHolder",
  datasetName: "http://rs.tdwg.org/dwc/terms/datasetName",
};

/**
 * Escape a value for a tab-delimited DwC file.
 *
 * Tabs, newlines and carriage returns inside any value — a rights holder's
 * name, say — would otherwise shift every subsequent column of that row, and
 * because the archive has no quoting, a single pasted newline silently corrupts
 * the file from that point on.
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

  // reports_public already excludes unpublished records and applies obscuring;
  // the `source = 'user'` filter inside selectOccurrences is the whole point of
  // this export.
  const rows = await selectOccurrences(sql, { includeUnidentified });

  // Belt and braces. If the query is ever edited carelessly, this stops an
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

  // Unlicensed records are left out here rather than in SQL, so that the count
  // of what was withheld can be printed: an archive that is empty because
  // nobody has granted a licence yet should say so, not look like a bug.
  const published = rows.flatMap((r) => {
    const values = toOccurrence(r, DATASET.title);
    return values ? [{ r, values }] : [];
  });
  const unlicensed = rows.length - published.length;

  await mkdir(outDir, { recursive: true });

  const lines = [TERMS.join("\t")];
  for (const { values } of published) {
    lines.push(TERMS.map((t) => cell(values[t])).join("\t"));
  }

  await writeFile(join(outDir, "occurrence.txt"), lines.join("\n") + "\n", "utf8");
  await writeFile(join(outDir, "meta.xml"), metaXml(), "utf8");
  await writeFile(
    join(outDir, "eml.xml"),
    emlXml(
      published.length,
      published[0]?.r.observed_at ?? null,
      published.at(-1)?.r.observed_at ?? null,
    ),
    "utf8",
  );

  const obscured = published.filter(({ r }) => r.is_obscured).length;
  console.log(`Darwin Core Archive -> ${outDir}`);
  console.log(`  ${published.length.toLocaleString()} occurrence records (source='user' only)`);
  console.log(`  ${obscured.toLocaleString()} with generalised coordinates, declared as such`);
  if (unlicensed > 0) {
    console.log(
      `  ${unlicensed.toLocaleString()} left out: their contributors have not granted a licence`,
    );
  }
  if (published.length === 0) {
    console.log(
      "\n  Nothing to publish yet. Records imported from GBIF are deliberately\n" +
        "  excluded, and a record of our own goes out only under a licence its\n" +
        "  contributor granted, which the report form does not yet ask for.",
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
