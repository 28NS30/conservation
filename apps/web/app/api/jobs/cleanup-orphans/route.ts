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
 * Driven by Vercel Cron; see apps/web/vercel.json. Cron issues GET — see the
 * note on the handler.
 */

/**
 * Generous, so a report queued on a phone is never collected mid-flight. It was
 * 24 hours, and a report saved in a valley on Friday and sent on Monday lost
 * the photos it had already uploaded (security audit, 29 September 2026).
 */
const MIN_AGE_HOURS = 7 * 24;
/** Storage deletes in batches of this; the job keeps going until the budget. */
const BATCH = 500;
const PAGE = 1000;
/** Well inside the function's limit, so a big backlog is worked off over runs. */
const TIME_BUDGET_MS = 40_000;
/**
 * rate_limits rows are only needed while their window is open, and the longest
 * window is a day. Older ones are a record of who sent what, when.
 */
const RATE_LIMIT_RETENTION = "2 days";

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * GET because that is the method Vercel Cron sends; POST for an external
 * scheduler or a manual run. Both behind CRON_SECRET. See the longer note in
 * ../classify/route.ts — this route had the same defect and the same
 * consequence, quieter: orphaned photos accumulate in Storage with nothing
 * reporting it.
 */
export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}

/** See ../classify/route.ts: a prerendered cleanup job would never delete anything. */
export const dynamic = "force-dynamic";

async function run(req: Request) {
  if (!authorised(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();

  // First, and whatever Storage does next: the forum's retention job used to
  // be the only thing that deleted these, and it runs only while the forum is
  // switched on, so rows naming (hashed) addresses were kept for good.
  const purged = await sql`
    delete from rate_limits where window_start < now() - ${RATE_LIMIT_RETENTION}::interval`;

  const storage = serviceSupabase().storage.from(PHOTO_BUCKET);
  const cutoff = Date.now() - MIN_AGE_HOURS * 3600_000;

  /** Every entry under a folder, however many pages Storage splits it into. */
  async function listAll(prefix: string) {
    const out: { name: string; created_at?: string | null }[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await storage.list(prefix, { limit: PAGE, offset });
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) return out;
    }
  }

  let scanned = 0;
  let deleted = 0;
  try {
    // Storage is organised as YYYY/MM/<uuid>.<ext>.
    for (const year of await listAll("")) {
      for (const month of await listAll(year.name)) {
        const prefix = `${year.name}/${month.name}`;
        const old = (await listAll(prefix))
          .filter((f) => (f.created_at ? Date.parse(f.created_at) : Date.now()) < cutoff)
          .map((f) => `${prefix}/${f.name}`);
        scanned += old.length;
        for (let i = 0; i < old.length; i += BATCH) {
          if (Date.now() - started > TIME_BUDGET_MS)
            return Response.json({ scanned, deleted, purged: purged.count, incomplete: true });
          const batch = old.slice(i, i + BATCH);
          // Anything still referenced by a report is kept, obviously.
          const referenced = await sql<{ storage_path: string }[]>`
            select storage_path from report_photos where storage_path = any(${batch})`;
          const keep = new Set(referenced.map((r) => r.storage_path));
          const orphans = batch.filter((p) => !keep.has(p));
          if (orphans.length === 0) continue;
          const { error } = await storage.remove(orphans);
          if (error) throw error;
          deleted += orphans.length;
        }
      }
    }
  } catch (e) {
    console.error("[cleanup-orphans]", (e as Error).message);
    return Response.json({ error: "cleanup_failed", scanned, deleted, purged: purged.count }, { status: 500 });
  }

  return Response.json({ scanned, deleted, purged: purged.count });
}
