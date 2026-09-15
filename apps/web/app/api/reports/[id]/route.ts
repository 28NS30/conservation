import { asPublic, sql } from "@/lib/db";
import { signedPhotoUrl } from "@/lib/supabase/service";
import type { Category, LocationPrecision } from "@conservation/shared";

/**
 * One public report, for the map's detail panel.
 *
 * The team asked that clicking a dot open a panel beside the map with the
 * photograph and the details under it. `/reports/[id]` already renders all of
 * that as a page; this is the same row as JSON so the panel can fill without a
 * navigation, which is the whole point of a panel.
 *
 * Read through `reports_public` as `web_anon`, exactly like the page: reports
 * that are unpublished, or whose taxon is rated 座標不開放, are absent from that
 * view, so this route cannot serve them rather than relying on a filter someone
 * has to remember to write.
 */
type Row = {
  id: string;
  category: Category;
  observed_at: string;
  notes: string | null;
  location_precision: LocationPrecision;
  is_obscured: boolean;
  taxon_id: number | null;
  taxon_source: string | null;
  scientific_name: string | null;
  common_name_zh: string | null;
  source: string;
  is_terrestrial: boolean | null;
  is_freshwater: boolean | null;
  is_brackish: boolean | null;
  is_marine: boolean | null;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json({ error: "bad_id" }, { status: 400 });

  const [row] = await asPublic(
    (tx) => tx<Row[]>`
      select rp.id, rp.category, rp.observed_at, rp.notes,
             rp.location_precision, rp.is_obscured,
             rp.taxon_id, rp.taxon_source, rp.source,
             t.scientific_name, t.common_name_zh,
             -- The species card's habitat type, so the panel says what the
             -- animal is and not only when it was seen. Public columns only.
             t.is_terrestrial, t.is_freshwater, t.is_brackish, t.is_marine
        from reports_public rp
        left join taxa t on t.id = rp.taxon_id
       where rp.id = ${id}::uuid`,
  );

  if (!row) return Response.json({ error: "not_found" }, { status: 404 });

  // Safe to read photo paths on the privileged connection: the row above has
  // already proved this report is publicly visible.
  const photos = await sql<{ storage_path: string }[]>`
    select storage_path from report_photos
     where report_id = ${id}::uuid order by created_at limit 1`;
  const photo = photos[0]
    ? await signedPhotoUrl(photos[0].storage_path, 900)
    : null;

  return Response.json(
    {
      id: row.id,
      category: row.category,
      observedAt: row.observed_at,
      notes: row.notes,
      locationPrecision: row.location_precision,
      isObscured: row.is_obscured,
      taxonId: row.taxon_id,
      taxonSource: row.taxon_source,
      scientificName: row.scientific_name,
      commonNameZh: row.common_name_zh,
      source: row.source,
      habitat: {
        isTerrestrial: row.is_terrestrial,
        isFreshwater: row.is_freshwater,
        isBrackish: row.is_brackish,
        isMarine: row.is_marine,
      },
      photo,
    },
    {
      // The photo URL is signed and short-lived, so this must not be cached by
      // anything shared. Everything else here is already public.
      headers: { "cache-control": "private, max-age=0, must-revalidate" },
    },
  );
}
