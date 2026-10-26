import { LIST_MAX_RECORDS, recentRecords } from "@/lib/species";

/**
 * A sparse species' records, each with its point, for its species page.
 *
 *   GET /api/species/32116/records
 *
 * The page itself is cached for everybody, and the list is the one thing on
 * it that places a record. Read here, per request, the points a reader sees
 * are the ones `reports_public` gives now, whatever the page's age, and no
 * cached copy of the page holds a point at all. That is the bound for a blur
 * tightened in the database, where no writer runs, made independent of how
 * long a cache keeps the page: on Vercel, a species page rendered on its
 * first visit, as all but fifty are, is stored with the platform's default
 * lifetime for a fallback route (expiration 1, no staleExpiration), and how
 * long it is then served stale is the platform's business, not this app's.
 * (Rendering the sparse pages per request instead is not possible on a
 * route that is cached: Next answers a cached route's render that turns
 * dynamic with "Page changed from static to dynamic at runtime".)
 *
 * Through `reports_public` as `web_anon`, like the page and the map: a record
 * that is unpublished, or of a taxon rated 座標不開放, is not in the view and
 * is never listed here. Only a sparse species' records: more than
 * LIST_MAX_RECORDS and its page draws a chart instead, so this answers none,
 * and no request reads more than one row past the list.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Nine digits is ten thousand times the taxa there are, and fits an int.
  if (!/^[1-9]\d{0,8}$/.test(id))
    return Response.json({ error: "bad_id" }, { status: 400 });

  const rows = await recentRecords(Number(id), LIST_MAX_RECORDS + 1);
  return Response.json(
    { records: rows.length > LIST_MAX_RECORDS ? [] : rows },
    // Not kept by anyone: the point is that it is read now.
    { headers: { "cache-control": "private, no-store" } },
  );
}
