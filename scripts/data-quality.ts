/**
 * The data-quality check: every invariant the 22 October audit checked by
 * hand, as one read-only query that returns one row of counts.
 *
 *   npx tsx scripts/data-quality.ts                     # against DATABASE_URL
 *   npx tsx scripts/data-quality.ts --sql > dq.sql      # the query, for the Management API
 *
 * Run it after every migration, TaiCOL refresh or remap, and record what it
 * says in a dated section of docs/production-state.md. The 韋氏水蛇 gap passed
 * every check that existed, and each number in that audit came from a query
 * someone wrote that day; this is those queries, kept.
 *
 * Two kinds of count. The ones in VIOLATIONS must be zero, and the script
 * exits 1 when any is not. The rest describe the corpus and are there to be
 * compared with the last run.
 *
 * Read-only, and safe to run against production: it selects counts, and the
 * few taxon ids it lists are names any visitor can look up. Counts of a taxon's
 * records come from reports_public, as in retired-twins.ts, so a taxon rated
 * 座標不開放 is never said to have been recorded.
 */
import { readOverrides, retiredTwinsSql } from "./taxa-overrides.ts";

/**
 * Taiwan and the islands it administers, as boxes in degrees. A point outside
 * all of them is a typing error or a record from somewhere else.
 */
const PLACES: Record<string, [number, number, number, number]> = {
  // Main island, Penghu, Green Island, Orchid Island and the islets near them.
  taiwan: [119.2, 21.7, 122.2, 25.5],
  // 彭佳嶼, 棉花嶼 and 花瓶嶼, north of Keelung.
  keelungIslets: [121.9, 25.4, 122.2, 25.7],
  kinmen: [118.1, 24.3, 118.6, 24.6],
  // 烏坵, Kinmen County's islets off the mainland coast.
  wuqiu: [119.4, 24.9, 119.5, 25.05],
  matsu: [119.8, 25.9, 120.6, 26.45],
  pratas: [116.6, 20.6, 116.8, 20.8],
};

/** The counts that must be zero. */
export const VIOLATIONS = [
  "looser_than_rule",
  "named_by_people_looser_than_binomial",
  "untaxoned_exact",
  "exact_point_moved",
  "blurred_point_not_moved",
  "public_notes_on_blurred",
  "public_test_reports",
  "floors_missing",
  "floors_weaker",
  "retired_twins_looser",
] as const;

function floorsSql(): string {
  const floors = readOverrides().map((f) => ({ taicol_id: f.taicol_id, min_precision: f.min_precision }));
  const json = JSON.stringify(floors);
  if (json.includes("$floors$")) throw new Error("the overrides contain the dollar-quote tag");
  return `select x.taicol_id, x.min_precision
            from jsonb_to_recordset($floors$${json}$floors$::jsonb) as x(taicol_id text, min_precision text)`;
}

function outsideSql(): string {
  const inside = Object.values(PLACES)
    .map(([w, s, e, n]) => `(st_x(r.location::geometry) between ${w} and ${e} and st_y(r.location::geometry) between ${s} and ${n})`)
    .join(" or ");
  return `not (${inside})`;
}

export function checkSql(): string {
  return `
with csv as (${floorsSql()}),
twins as (${retiredTwinsSql()})
select json_build_object(
  -- A record less blurred than its taxon's rule and its own override allow.
  'looser_than_rule', (select count(*) from reports r
     where precision_rank(r.location_precision) < precision_rank(report_precision(r.taxon_id, r.precision_override))),
  -- Named by a person or the model, and less blurred than the strictest row
  -- sharing its binomial (0026).
  'named_by_people_looser_than_binomial', (select count(*) from reports r
     where r.taxon_id is not null and r.taxon_source in ('user', 'ai', 'expert')
       and precision_rank(r.location_precision) < precision_rank(binomial_precision(r.taxon_id))),
  -- Nobody knows what is on the pin, so it is at 10 km at best (0011).
  'untaxoned_exact', (select count(*) from reports r
     where r.taxon_id is null and r.location_precision = 'exact'),
  'exact_point_moved', (select count(*) from reports r
     where r.location_precision = 'exact'
       and not st_equals(r.location::geometry, r.location_public::geometry)),
  'blurred_point_not_moved', (select count(*) from reports r
     where r.location_precision in ('coarse_10km', 'coarse_50km')
       and st_equals(r.location::geometry, r.location_public::geometry)),
  'public_notes_on_blurred', (select count(*) from reports_public p
     where p.location_precision <> 'exact' and p.notes is not null),
  'public_test_reports', (select count(*) from reports_public p
     join reports r on r.id = p.id where r.is_test),
  -- scripts/taxa-overrides.csv against production's floors.
  'floors_missing', (select count(*) from csv
     where not exists (select 1 from taxon_precision_floors f where f.taicol_id = csv.taicol_id)),
  'floors_weaker', (select count(*) from csv join taxon_precision_floors f using (taicol_id)
     where precision_rank(f.min_precision) < precision_rank(csv.min_precision)),
  'retired_twins_looser', (select count(*) from twins where looser),

  -- What there is, for comparing with the last run.
  'reports', (select count(*) from reports),
  'public', (select count(*) from reports_public),
  'public_from_people', (select count(*) from reports_public where source <> 'gbif'),
  'by_precision', (select json_object_agg(location_precision, n) from
     (select location_precision, count(*) as n from reports group by 1) x),
  'recorded_taxa', (select count(*) from species_report_stats),
  'floors', (select count(*) from taxon_precision_floors),
  'floors_not_in_csv', (select count(*) from taxon_precision_floors f
     where not exists (select 1 from csv where csv.taicol_id = f.taicol_id)),
  -- Records on a name TaiCOL no longer accepts or does not record in Taiwan:
  -- the biologist's queue (docs/biologist-queue.md).
  'public_on_names_not_used_here', (select count(*) from reports_public p join taxa t on t.id = p.taxon_id
     where t.taxon_status is distinct from 'accepted' or not t.is_in_taiwan),
  'names_not_used_here', (select json_agg(x.taicol_id order by x.n desc) from
     (select t.taicol_id, count(*) as n from reports_public p join taxa t on t.id = p.taxon_id
       where t.taxon_status is distinct from 'accepted' or not t.is_in_taiwan
       group by 1 order by 2 desc limit 10) x),
  'untaxoned', (select count(*) from reports where taxon_id is null),
  'observed_in_future', (select count(*) from reports where observed_at > now() + interval '1 day'),
  'observed_before_2000', (select count(*) from reports where observed_at < '2000-01-01'),
  'outside_taiwan', (select count(*) from reports r where ${outsideSql()}),
  'ledger_rows', (select count(*) from _migrations),
  'ledger_head', (select max(name) from _migrations),
  'db_mb', round(pg_database_size(current_database()) / 1048576.0)
) as quality;
`;
}

async function main() {
  const query = checkSql();
  if (process.argv.includes("--sql")) {
    process.stdout.write(query);
    return;
  }
  // Loaded here, not at the top: db.ts connects when it is loaded, and --sql
  // has nothing to connect to.
  const { sql } = await import("./db.ts");
  try {
    const [{ quality }] = await sql.unsafe<{ quality: Record<string, unknown> }[]>(query);
    console.log(JSON.stringify(quality, null, 2));
    const bad = VIOLATIONS.filter((k) => Number(quality[k]) !== 0);
    console.log(bad.length === 0 ? "\nEvery invariant holds." : `\nBroken: ${bad.map((k) => `${k} ${quality[k]}`).join(", ")}`);
    process.exitCode = bad.length === 0 ? 0 : 1;
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
