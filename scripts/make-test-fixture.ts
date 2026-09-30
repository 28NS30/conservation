/**
 * Generate a compact, self-contained test fixture.
 *
 *   npm run make:fixture
 *
 * CI cannot run the real importers: TaiCOL takes ~4 minutes against a live
 * government API, and GBIF is intermittently slow. So we extract just enough real
 * data to exercise every invariant — including one taxon of each sensitivity
 * level, since those drive the location-privacy rules.
 *
 * Writes supabase/seed-test.sql, applied by `supabase db reset` in CI.
 *
 * The file is public, in the repository, so two rules (security audit, 29
 * September 2026):
 *   - Only published GBIF records, never a test or a person's report. The
 *     sample used to take any report of a fixture taxon, and the fixture
 *     taxa are the ones the report picker is built around.
 *   - A record the site blurs is written at the centre of its blur cell, not
 *     at its true point. The blur keys on the cell and the record's id
 *     (obscure_point), so the test database publishes the same point as
 *     before; only the point nobody sees is gone. It was committed for 17
 *     rows, a 座標不開放 snake among them.
 *
 * And it reads only a local database: nothing here should be run against
 * production.
 */
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "seed-test.sql");
const REPORT_SAMPLE = 600;

const lit = (v: unknown): string =>
  v === null || v === undefined ? "NULL" : typeof v === "boolean" || typeof v === "number"
    ? String(v)
    : Array.isArray(v)
      // Chinese alternate names, which the search matches on and which used to
      // be patched into the generated file by hand — the one thing in it that a
      // regeneration silently threw away.
      ? `array[${v.map(lit).join(",")}]::text[]`
      : `'${String(v).replace(/'/g, "''")}'`;

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    console.error(`make-test-fixture reads a local database only, not ${host}.`);
    process.exit(1);
  }

  // Taxa the privacy tests depend on by name or property, plus whatever the
  // sampled reports reference.
  const taxa = await sql<Record<string, unknown>[]>`
    with wanted as (
      (select id from taxa where scientific_name = 'Paguma larvata' limit 1)
      union (select id from taxa where scientific_name = 'Prionailurus bengalensis' limit 1)
      -- The species the report form's picker is built around. Each pins a
      -- different property of the search: the iguana's own TaiCOL name is 綠鬛蜥
      -- and the spelling everyone else uses is only an alternate; 福壽螺 is an
      -- invasive sharing a Chinese name with non-invasive relatives; and
      -- euptilurus is a subspecies whose common name 石虎 is an alternate name
      -- of the species that holds every leopard cat record.
      union (select id from taxa where scientific_name = 'Iguana iguana' limit 1)
      union (select id from taxa where scientific_name = 'Pomacea canaliculata' limit 1)
      union (select id from taxa
              where scientific_name = 'Prionailurus bengalensis euptilurus' limit 1)
      -- Migration 0014's cases: 臺灣蛇蜥 under its accepted and its deleted row,
      -- the non-Taiwan row TaiCOL moved its protection to, both cockatoo rows,
      -- and a deleted name still flagged invasive. See the floors in
      -- scripts/taxa-overrides.csv. Then 黃頸蝠's accepted row and the
      -- retired twin that carries its rating, and Dorcus hopei with its one
      -- protected Taiwan subspecies.
      union (select id from taxa
              where taicol_id in ('t0028707', 't0124331', 't0124472',
                                  't0125438', 't0076951', 't0123866',
                                  't0072234', 't0102479',
                                  't0102470', 't0028710'))
      union (select id from taxa where sensitivity = '座標不開放' limit 2)
      union (select id from taxa where sensitivity = '重度' limit 2)
      union (select id from taxa where sensitivity = '輕度' limit 3)
      union (select id from taxa where is_invasive limit 3)
      union (select taxon_id from reports
              where taxon_id is not null and source = 'gbif'
              order by id limit 60)
    )
    select t.id, t.taicol_id,
           -- Both matter since 0014: only accepted names are offered, and a
           -- subspecies inherits a stricter rating from the row above it.
           t.parent_taicol_id, t.taxon_status,
           t.scientific_name, t.common_name_zh, t.rank,
           t.kingdom, t.phylum, t.class, t."order", t.family,
           t.is_in_taiwan, t.is_endemic, t.alien_type, t.is_invasive,
           t.protected_status, t.sensitivity, t.alt_names_zh,
           -- Conservation codes. Patched into the generated file by hand in #21
           -- and, like the alternate names, thrown away by the next run.
           t.iucn, t.redlist, t.cites, t.bioclip_prompt
      from taxa t join wanted w on w.id = t.id
     where t.id is not null
     order by t.id`;

  const taxonIds = taxa.map((t) => Number(t.id));

  // Evenly spread across the whole date range, not the earliest N — date-filter
  // tests need data on both sides of any cutoff, and a head-of-list sample would
  // collapse the range to a few weeks.
  const reports = await sql<Record<string, unknown>[]>`
    with eligible as (
      select r.*, row_number() over (order by r.observed_at) as rn,
             count(*) over () as total
        from reports r
       -- Must be restricted to the taxa the fixture actually includes, or the
       -- inserts fail on a foreign key when loaded into a fresh database.
       where r.taxon_id = any(${sql.array(taxonIds)}::bigint[])
         and r.source = 'gbif' and r.status = 'published' and not r.is_test
    )
    select e.id::text, e.category,
           -- The true point only where the site publishes it; otherwise the
           -- centre of the blur cell (see the note at the top).
           case when c.deg > 0
                then floor(st_x(e.location::geometry) / c.deg) * c.deg + c.deg / 2
                else st_x(e.location::geometry) end as lng,
           case when c.deg > 0
                then floor(st_y(e.location::geometry) / c.deg) * c.deg + c.deg / 2
                else st_y(e.location::geometry) end as lat,
           e.observed_at, e.taxon_id, e.taxon_source, e.status, e.source, e.source_id,
           e.license, e.rights_holder
      from eligible e
      cross join lateral (
        select case when e.location_precision = 'exact' then 0
                    else precision_cell_deg(e.location_precision) end as deg) c
     where e.rn % greatest(1, (e.total / ${REPORT_SAMPLE})::int) = 0
        -- Always keep a few 石虎 records. An even sample across the whole date
        -- range caught none of them, which left the species the privacy tests
        -- name present in the checklist with nothing recorded — and the search,
        -- which ranks a taxon with records first, then put a recordless
        -- subspecies of the same name above it.
        or e.id in (
          select id from reports
           where taxon_id = (select id from taxa
                              where scientific_name = 'Prionailurus bengalensis' limit 1)
             and source = 'gbif' and status = 'published' and not is_test
           order by observed_at limit 4
        )
     order by e.observed_at
     limit ${REPORT_SAMPLE}`;

  const taxaCols = [
    "id","taicol_id","parent_taicol_id","taxon_status",
    "scientific_name","common_name_zh","rank","kingdom","phylum","class",
    '"order"',"family","is_in_taiwan","is_endemic","alien_type","is_invasive",
    "protected_status","sensitivity","alt_names_zh","iucn","redlist","cites",
    "bioclip_prompt",
  ];
  const taxaKeys = taxaCols.map((c) => c.replace(/"/g, ""));

  const lines: string[] = [
    "-- Generated by `npm run make:fixture`. Do not edit by hand.",
    "-- A minimal slice of real TaiCOL + TaiRON data: enough to exercise every",
    "-- location-privacy invariant without hitting external APIs in CI.",
    "",
    `insert into taxa (${taxaCols.join(",")}) values`,
    taxa
      .map((t) => `  (${taxaKeys.map((k) => lit(t[k])).join(",")})`)
      .join(",\n") + ";",
    "",
    "select setval(pg_get_serial_sequence('taxa','id'), (select max(id) from taxa));",
    "",
    "insert into reports (id, category, location, location_public, observed_at, taxon_id,",
    "                     taxon_source, status, source, source_id, license, rights_holder) values",
    reports
      .map((r) => {
        const pt = `st_setsrid(st_makepoint(${Number(r.lng)},${Number(r.lat)}),4326)::geography`;
        return `  (${lit(r.id)}::uuid, ${lit(r.category)}, ${pt}, ${pt}, ${lit(
          (r.observed_at as Date).toISOString(),
        )}, ${lit(r.taxon_id)}, ${lit(r.taxon_source)}, ${lit(r.status)}, ${lit(r.source)}, ${lit(
          r.source_id,
        )}, ${lit(r.license)}, ${lit(r.rights_holder)})`;
      })
      .join(",\n") + ";",
    "",
  ];

  // The rule above, checked on what is about to be written.
  const stray = reports.filter((r) => r.source !== "gbif" || r.status !== "published");
  if (stray.length) {
    console.error(`refusing to write ${stray.length} record(s) that are not published GBIF records`);
    process.exit(1);
  }

  await writeFile(OUT, lines.join("\n"));

  const sensitivities = new Set(taxa.map((t) => t.sensitivity).filter(Boolean));
  console.log(`
  wrote ${OUT}
  taxa            ${taxa.length}
  reports         ${reports.length}
  sensitivities   ${[...sensitivities].join(", ") || "(none)"}
  date range      ${(reports[0]?.observed_at as Date)?.toISOString().slice(0, 10)} → ${(reports.at(-1)?.observed_at as Date)?.toISOString().slice(0, 10)}`);

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
