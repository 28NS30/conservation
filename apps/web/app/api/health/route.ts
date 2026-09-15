import { asPublic } from "@/lib/db";

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
    return Response.json(
      {
        ok: true,
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
