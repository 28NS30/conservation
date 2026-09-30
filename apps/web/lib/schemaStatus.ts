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
    // POST /api/reports writes the contributor-terms answers here; without the
    // columns every report fails to insert.
    name: "0017 reports record what the contributor agreed to",
    sql: `select count(*) = 3 as ok from information_schema.columns
           where table_schema = 'public' and table_name = 'reports'
             and column_name in ('share_partners', 'consent_version', 'consent_at')`,
  },
  {
    // POST /api/reports writes is_test, so without the column every report
    // fails to insert. And a rule check with it: the column alone does not
    // keep a test off the map; the view's definition is what says it does.
    name: "0018 test reports are never public",
    sql: `select exists (
              select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'reports'
                 and column_name = 'is_test')
         and exists (
              select 1 from pg_views
               where schemaname = 'public' and viewname = 'reports_public'
                 and definition like '%is_test%') as ok`,
  },
  {
    // A rule check: 0024 revokes EXECUTE on every function this project
    // defines, so none is a public /rest/v1/rpc endpoint. A migration that
    // creates a function as another role, or grants one back, reopens it.
    // CI's plain Postgres has no anon role, which a CASE keeps from erroring.
    name: "0024 the REST API cannot call the site's functions",
    sql: `select case when not exists (select 1 from pg_roles where rolname = 'anon') then true
                 else not exists (
                   select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public'
                      and has_function_privilege('anon', p.oid, 'execute')
                      and not exists (select 1 from pg_depend d
                                       where d.objid = p.oid and d.deptype = 'e'))
            end as ok`,
  },
  {
    // Rule checks: a re-run of 0018 or 0016 puts notes back on blurred
    // records, and one of 0006 drops the suggestions' blur check, while every
    // column still exists. The view definitions say which rule is live.
    name: "0025 a blurred record publishes no notes",
    sql: `select exists (select 1 from pg_views
                          where viewname = 'reports_published'
                            and definition ~ 'THEN (reports\\.)?notes') as ok`,
  },
  {
    name: "0025 the model's suggestions respect the record's blur",
    sql: `select exists (select 1 from pg_views
                          where viewname = 'report_ai_suggestions'
                            and definition like '%suggestions_within_blur%') as ok`,
  },
  {
    name: "0027 a photograph belongs to one report",
    sql: `select exists (select 1 from pg_indexes
                          where tablename = 'report_photos'
                            and indexname = 'report_photos_storage_path_key') as ok`,
  },
  {
    // A rule check again: 0029 replaces 0021's taxon_precision() without its
    // Red List term (owner decision, 30 September 2026). Re-running 0021 alone
    // would quietly put the term back, blurring records the owner decided to
    // show, while every object still exists. The function body says which rule
    // is live.
    name: "0029 the blur follows the protected list and TaiCOL, not the Red List",
    sql: `select exists (
            select 1 from pg_proc
             where proname = 'taxon_precision'
               and prosrc not like '%precision_from_redlist(%') as ok`,
  },
  {
    // 0028's index on binomial_of() went unused in any session where web_anon
    // planned a query on taxa first, and a record page's suggestions check
    // could then time out. Re-running 0028 alone would put that index back.
    name: "0031 the binomial index is on the expression",
    sql: `select exists (
            select 1 from pg_indexes
             where indexname = 'taxa_binomial_idx'
               and indexdef not like '%binomial_of%') as ok`,
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
  {
    // Without it every feed fails: they sort by the views' score and hot.
    name: "0030 forum votes, scores and replies to replies",
    sql: `select to_regclass('public.forum_votes') is not null
             and exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'forum_threads_public'
                            and column_name = 'hot')
             and exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'forum_posts_public'
                            and column_name = 'path') as ok`,
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
