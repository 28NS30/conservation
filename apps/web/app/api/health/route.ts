import { asPublic } from "@/lib/db";
import { schemaStatus } from "@/lib/schemaStatus";

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
    const schema = await schemaStatus();

    return Response.json(
      {
        ok: true,
        // False means the database is not the one this code was written
        // against. That USED to mean exactly one thing — the code writes a
        // column that is not there, so every submission 500s — and the list has
        // since grown to cover privacy rules too: 0011 blurs an unidentified
        // record, 0012 re-blurs one whose taxon has been reclassified. A
        // deployment can be missing those and still take reports perfectly
        // well. It is still not the database this code expects.
        //
        // `npm run db:migrate` against that database says what to do —
        // including for one built by the psql loop in the launch checklist,
        // which has no migration history. `schemaMissing` names which.
        schemaCurrent: schema.current,
        ...(schema.missing.length ? { schemaMissing: schema.missing } : {}),
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
