import { listSpecies } from "@/lib/species";
import { REPORT_PAGES, isReportPage } from "@conservation/shared";

/**
 * Species autocomplete.
 *
 *   GET /api/species/search?q=石虎&filter=all&prefer=native
 *   GET /api/species/search?q=八哥&page=invasive
 *
 * Backs the species directory, the map's species filter and the report pages'
 * picker. Reads only public data (see lib/species.ts), so it cannot expose a
 * suppressed taxon's record volume.
 *
 * `prefer=native` orders native species first without excluding anything: a
 * roadkill victim is very often not native, so there the preference is a
 * ranking and never a wall.
 *
 * `page=` is the report pages' picker, and it stands in for the other two
 * parameters: each page's species are defined once, in REPORT_PAGES, and
 * `POST /api/reports` refuses a species outside them. So the picker asks by
 * page, and cannot be pointed at a wider list than the server will accept —
 * which is what the invasive page's old "search all species" button did,
 * filing native animals as invasive ones.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  const pageParam = url.searchParams.get("page");
  if (pageParam !== null && !isReportPage(pageParam))
    return Response.json({ error: "bad_page" }, { status: 400 });
  const scope =
    pageParam !== null && isReportPage(pageParam)
      ? REPORT_PAGES[pageParam].species
      : undefined;

  const filterParam =
    url.searchParams.get("filter") ??
    (scope?.invasiveOnly ? "invasive" : "all");
  const filter = (["recorded", "all", "invasive", "protected", "endemic"] as const).find(
    (f) => f === filterParam,
  );

  if (!filter) return Response.json({ error: "bad_filter" }, { status: 400 });

  const preferParam = url.searchParams.get("prefer");
  if (preferParam !== null && preferParam !== "native")
    return Response.json({ error: "bad_prefer" }, { status: 400 });
  // A page that offers every animal ranks natives first, as the form always
  // did; the invasive page has no natives to rank.
  const preferNative =
    preferParam === "native" || (scope !== undefined && !scope.invasiveOnly);
  // A bare `%%` scan of 66k taxa on every empty keystroke is wasteful and the
  // result is meaningless.
  if (q.length < 1) return Response.json({ results: [] });
  if (q.length > 64) return Response.json({ error: "query_too_long" }, { status: 400 });

  const results = await listSpecies({ q, filter, preferNative, scope, limit: 12 });

  return Response.json(
    { results },
    {
      headers: {
        // Short cache: species data changes only on re-import, but record counts
        // shift as reports come in.
        "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
      },
    },
  );
}
