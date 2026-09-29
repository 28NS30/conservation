import "server-only";
import { sql } from "@/lib/db";
import { forumEnabled, type ForumEnv } from "@/lib/forum/gate";

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
    // The dangerous half of 0013. `taxa` open to the anon key meant one
    // unauthenticated DELETE could strip the species from every record.
    name: "0013 the REST API is closed",
    sql: `select not exists (
            select 1 from information_schema.role_table_grants
             where table_schema = 'public'
               and grantee in ('anon','authenticated')
               and table_name not in
                   ('spatial_ref_sys','geometry_columns','geography_columns')) as ok`,
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
  {
    // The classifier calls this when it names a species. Without it every
    // confident classification fails, retries five times and is held as
    // "classification unavailable" — safe, but nothing gets identified.
    name: "0014 the classifier's sibling blur exists",
    sql: `select exists (
            select 1 from pg_proc
             where proname = 'binomial_precision_floor') as ok`,
  },
  {
    // A rule check, like 0011's. The trigger function is `create or replace`d
    // by 0003, 0011 and 0014, so re-running an older file puts the one-row
    // rule back while every object this list asks about still exists. Asking
    // what the live function body calls is what notices.
    name: "0014 a record takes the strictest rule that applies",
    sql: `select exists (
            select 1 from pg_proc
             where proname = 'set_report_public_location'
               and prosrc like '%report_precision(%') as ok`,
  },
  {
    name: "0014 precision floors re-blur their records",
    sql: `select exists (
            select 1 from pg_trigger t
              join pg_class c on c.oid = t.tgrelid
             where c.relname = 'taxon_precision_floors'
               and t.tgname = 'taxon_precision_floors_reblur'
               and not t.tgisinternal) as ok`,
  },
  {
    // A rule check again: 0021 replaces 0014's taxon_precision(), so re-running
    // 0014 alone would quietly drop the Red List term while every object still
    // exists. The function body is what says which rule is live.
    name: "0021 a threatened species on Taiwan's Red List is blurred",
    sql: `select exists (
            select 1 from pg_proc
             where proname = 'taxon_precision'
               and prosrc like '%precision_from_redlist(%') as ok`,
  },
  {
    // Read, not written, but read by every public surface at once: the map's
    // tiles, the record list, the record page, /stats and the three
    // collection pages all select it. Without it they 500 together.
    name: "0016 reports_public.is_invasive",
    sql: `select exists (
            select 1 from information_schema.columns
             where table_name = 'reports_public'
               and column_name = 'is_invasive') as ok`,
  },
];

/**
 * What the forum needs, asked only while the forum is switched on.
 *
 * The forum ships dark (lib/forum/gate.ts) and, switched off, runs no query
 * against these tables at all — so a database without 0019 is, for that
 * deployment, a database this code is fine with, and saying otherwise would
 * put a false alarm on /api/health until the owner applied a migration for a
 * feature nobody can reach. Switched on, a missing 0019 makes every forum page
 * a 500, which is exactly what this list exists to say first.
 *
 * Asks for the append-only trigger as well as the tables: the audit log is
 * only an audit log if it cannot be edited.
 */
export const FORUM_SCHEMA: SchemaCheck[] = [
  {
    name: "0019 the forum's tables and public views",
    sql: `select (select count(*) from information_schema.tables
                   where table_schema = 'public'
                     and table_name in ('forum_categories', 'forum_profiles', 'forum_threads',
                                        'forum_posts', 'forum_post_meta', 'forum_post_revisions',
                                        'forum_flags', 'forum_sanctions', 'forum_watched_words',
                                        'forum_mod_actions', 'forum_categories_public',
                                        'forum_threads_public', 'forum_posts_public',
                                        'forum_profiles_public')) = 14 as ok`,
  },
  {
    name: "0019 the moderation log is append-only",
    sql: `select exists (
            select 1 from pg_trigger t
              join pg_class c on c.oid = t.tgrelid
             where c.relname = 'forum_mod_actions'
               and t.tgname = 'forum_mod_actions_no_update'
               and not t.tgisinternal) as ok`,
  },
];

/** The checks this deployment needs: the forum's only while it is on. */
export function requiredSchema(env: ForumEnv = process.env): SchemaCheck[] {
  return forumEnabled(env) ? [...REQUIRED_SCHEMA, ...FORUM_SCHEMA] : REQUIRED_SCHEMA;
}

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
  checks: SchemaCheck[] = requiredSchema(),
): Promise<{ current: boolean; missing: string[] }> {
  const missing: string[] = [];
  for (const c of checks) {
    const [row] = await sql.unsafe<{ ok: boolean }[]>(c.sql);
    if (!row?.ok) missing.push(c.name);
  }
  return { current: missing.length === 0, missing };
}
