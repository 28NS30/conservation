import { listSpecies } from "@/lib/species";

/**
 * Species autocomplete.
 *
 *   GET /api/species/search?q=石虎&filter=all&prefer=native
 *
 * Backs the species directory, the map's species filter and the report form's
 * picker. Reads only public data (see lib/species.ts), so it cannot expose a
 * suppressed taxon's record volume.
 *
 * `prefer=native` orders native species first without excluding anything: the
 * report form scopes an invasive report to the invasive register, but a wildlife
 * or roadkill report can legitimately be of a non-native animal, so there the
 * preference is a ranking and never a wall.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const filterParam = url.searchParams.get("filter") ?? "all";
  const filter = (["recorded", "all", "invasive", "protected", "endemic"] as const).find(
    (f) => f === filterParam,
  );

  if (!filter) return Response.json({ error: "bad_filter" }, { status: 400 });

  const preferParam = url.searchParams.get("prefer");
  if (preferParam !== null && preferParam !== "native")
    return Response.json({ error: "bad_prefer" }, { status: 400 });
  const preferNative = preferParam === "native";
  // A bare `%%` scan of 66k taxa on every empty keystroke is wasteful and the
  // result is meaningless.
  if (q.length < 1) return Response.json({ results: [] });
  if (q.length > 64) return Response.json({ error: "query_too_long" }, { status: 400 });

  const results = await listSpecies({ q, filter, preferNative, limit: 12 });

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
