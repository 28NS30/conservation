import "server-only";
import { sql } from "@/lib/db";

/**
 * Whether the database has what the deployed code writes.
 *
 * Deploys are automatic and migrations are not, so a release can reach users
 * before the columns it writes reach the database. From outside, that
 * deployment renders perfectly and 500s every submission — and this site has
 * not had its first user submission yet, so nobody would notice.
 *
 * `_migrations` cannot answer this: production's schema was created by looping
 * psql over the files, which never populated that table. So each check asks
 * about the shape itself.
 *
 * Add one whenever a migration adds something the app writes.
 */
export type SchemaCheck = { name: string; sql: string };

export const REQUIRED_SCHEMA: SchemaCheck[] = [
  {
    name: "0009 taxon_source accepts 'unknown'",
    sql: `select exists (
            select 1 from pg_constraint
             where conname = 'reports_taxon_source_check'
               and pg_get_constraintdef(oid) like '%unknown%') as ok`,
  },
  {
    name: "0010 reports.location_accuracy_m",
    sql: `select exists (
            select 1 from information_schema.columns
             where table_name = 'reports'
               and column_name = 'location_accuracy_m') as ok`,
  },
  {
    name: "0010 reports_public.location_accuracy_m",
    sql: `select exists (
            select 1 from information_schema.columns
             where table_name = 'reports_public'
               and column_name = 'location_accuracy_m') as ok`,
  },
  {
    // Not a shape check like the others: this one asks whether the rule holds.
    // A missing 0011 is invisible in the schema — the trigger still exists and
    // still runs — and only shows up as published rows sitting at their true
    // coordinates with nothing that could have vouched for them.
    name: "0011 unidentified records are blurred",
    sql: `select not exists (
            select 1 from reports
             where status = 'published'
               and taxon_id is null
               and location_precision = 'exact') as ok`,
  },
  {
    name: "0012 a reclassified taxon re-blurs its records",
    sql: `select exists (
            select 1 from pg_trigger t
              join pg_class c on c.oid = t.tgrelid
             where c.relname = 'taxa'
               and t.tgname = 'taxa_reblur_reports'
               and not t.tgisinternal) as ok`,
  },
];

/**
 * Runs the checks and returns what is missing.
 *
 * The queries are built HERE, per call, and not held in a module-level array of
 * tagged templates. A postgres.js query object is a promise: awaiting it a
 * second time resolves the first result rather than running anything. Held at
 * module scope it would answer for the life of the process — so after someone
 * applied the missing migration this would keep reporting it missing, and send
 * them looking for a problem they had already fixed.
 */
export async function schemaStatus(
  checks: SchemaCheck[] = REQUIRED_SCHEMA,
): Promise<{ current: boolean; missing: string[] }> {
  const missing: string[] = [];
  for (const c of checks) {
    const [row] = await sql.unsafe<{ ok: boolean }[]>(c.sql);
    if (!row?.ok) missing.push(c.name);
  }
  return { current: missing.length === 0, missing };
}
