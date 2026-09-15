import { asPublic, sql } from "@/lib/db";

/**
 * Schema the write path needs, and which release added it.
 *
 * Deploys are automatic and migrations are not: `supabase/migrations/*.sql` is
 * applied by hand against production (docs/launch-checklist.md), so code that
 * writes a new column reaches users before the column does. The failure is
 * invisible from outside — the site renders perfectly and every submission
 * 500s, which on a site with no submissions yet nobody would notice.
 *
 * `_migrations` cannot answer this: production's schema was created by looping
 * psql over the files, which never populated that table. So the check asks
 * about the shape itself.
 *
 * Add a line here whenever a migration adds something the app writes.
 */
const REQUIRED = [
  {
    name: "0009 taxon_source accepts 'unknown'",
    check: sql`select exists (
      select 1 from pg_constraint
       where conname = 'reports_taxon_source_check'
         and pg_get_constraintdef(oid) like '%unknown%') as ok`,
  },
  {
    name: "0010 reports.location_accuracy_m",
    check: sql`select exists (
      select 1 from information_schema.columns
       where table_name = 'reports' and column_name = 'location_accuracy_m') as ok`,
  },
  {
    name: "0010 reports_public.location_accuracy_m",
    check: sql`select exists (
      select 1 from information_schema.columns
       where table_name = 'reports_public'
         and column_name = 'location_accuracy_m') as ok`,
  },
] as const;

/**
 * Liveness + dependency check.
 *
 * Deliberately queries through `asPublic()`: that exercises the `web_anon` role
 * and the `reports_public` view, so it fails if the privacy grants are broken —
 * not just if Postgres is down.
 */
export async function GET() {
  const started = Date.now();
  try {
    const [row] = await asPublic(
      (tx) => tx<{ reports: number; taxa: number; species: number }[]>`
        select (select count(*) from reports_public)::int as reports,
               (select count(*) from taxa)::int          as taxa,
               -- Species we hold records FOR, which is not the size of the
               -- checklist: 458 against 125,438. The parent site advertises this
               -- one, and had it hardcoded because the taxa count is the checklist.
               (select count(distinct taxon_id) from reports_public
                 where taxon_id is not null)::int        as species`,
    );
    // Runs on the app's own connection: `web_anon` has no privileges on
    // `reports`, and information_schema shows you only what you may touch — so
    // asking as the public role would report every column missing.
    const missing: string[] = [];
    for (const r of REQUIRED) {
      const [row] = (await r.check) as unknown as { ok: boolean }[];
      if (!row?.ok) missing.push(r.name);
    }

    return Response.json(
      {
        ok: true,
        // False means this deployment cannot accept a report: the code writes
        // something the database does not have. Run `npm run db:migrate`
        // against production.
        schemaCurrent: missing.length === 0,
        ...(missing.length ? { schemaMissing: missing } : {}),
        reports: row.reports,
        taxa: row.taxa,
        species: row.species,
        dbLatencyMs: Date.now() - started,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[health]", err);
    return Response.json({ ok: false, error: "database_unreachable" }, { status: 503 });
  }
}
