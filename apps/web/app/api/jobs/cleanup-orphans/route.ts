import { sql } from "@/lib/db";
import { serviceSupabase, PHOTO_BUCKET } from "@/lib/supabase/service";

/**
 * Delete photos that were uploaded but never attached to a report.
 *
 * The offline queue uploads photos before it posts the report, and resumes
 * partial uploads across retries. A report the user discards — or one that fails
 * permanently — therefore leaves objects in Storage with no `report_photos` row.
 * Without this job that leaks quota quietly and forever.
 *
 * Driven by Vercel Cron; see vercel.json.
 */

/** Generous, so a report queued overnight on a phone is never collected mid-flight. */
const MIN_AGE_HOURS = 24;
const MAX_DELETE = 500;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const storage = serviceSupabase().storage.from(PHOTO_BUCKET);
  const cutoff = Date.now() - MIN_AGE_HOURS * 3600_000;

  // Storage is organised as YYYY/MM/<uuid>.webp.
  const { data: years, error: yearErr } = await storage.list("", { limit: 100 });
  if (yearErr) {
    console.error("[cleanup-orphans]", yearErr);
    return Response.json({ error: "list_failed" }, { status: 500 });
  }

  const candidates: string[] = [];
  for (const year of years ?? []) {
    const { data: months } = await storage.list(year.name, { limit: 100 });
    for (const month of months ?? []) {
      const prefix = `${year.name}/${month.name}`;
      const { data: files } = await storage.list(prefix, { limit: 1000 });
      for (const f of files ?? []) {
        const created = f.created_at ? Date.parse(f.created_at) : Date.now();
        if (created < cutoff) candidates.push(`${prefix}/${f.name}`);
        if (candidates.length >= MAX_DELETE * 4) break;
      }
    }
  }

  if (candidates.length === 0) return Response.json({ scanned: 0, deleted: 0 });

  // Anything still referenced by a report is kept, obviously.
  const referenced = await sql<{ storage_path: string }[]>`
    select storage_path from report_photos where storage_path = any(${candidates})`;
  const keep = new Set(referenced.map((r) => r.storage_path));
  const orphans = candidates.filter((p) => !keep.has(p)).slice(0, MAX_DELETE);

  if (orphans.length === 0) {
    return Response.json({ scanned: candidates.length, deleted: 0 });
  }

  const { error: delErr } = await storage.remove(orphans);
  if (delErr) {
    console.error("[cleanup-orphans]", delErr);
    return Response.json({ error: "delete_failed" }, { status: 500 });
  }

  return Response.json({ scanned: candidates.length, deleted: orphans.length });
}
