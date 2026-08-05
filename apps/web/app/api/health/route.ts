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
      (tx) => tx<{ reports: number; taxa: number }[]>`
        select (select count(*) from reports_public)::int as reports,
               (select count(*) from taxa)::int          as taxa`,
    );
    return Response.json(
      { ok: true, reports: row.reports, taxa: row.taxa, dbLatencyMs: Date.now() - started },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[health]", err);
    return Response.json({ ok: false, error: "database_unreachable" }, { status: 503 });
  }
}
