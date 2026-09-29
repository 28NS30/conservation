import { classifyQueued } from "@/lib/report/classifyWorker";

/**
 * Classification worker, driven by Vercel Cron (see apps/web/vercel.json).
 *
 *   GET  /api/jobs/classify     Authorization: Bearer $CRON_SECRET
 *   POST /api/jobs/classify     Authorization: Bearer $CRON_SECRET
 *
 * Claims jobs with `for update skip locked` so concurrent invocations never
 * process the same report twice.
 *
 * Two contracts with the model service, chosen by ML_CONTRACT (mlContract in
 * lib/report/classifyPolicy.ts). Unset, the worker behaves exactly as it
 * always has: it sends the report's category, the service picks the label
 * list and the band, and the branches below act on its answer. At "2" the
 * service returns the top 50 species over every accepted Taiwan taxon and the
 * website applies the rules for each kind of report itself
 * (lib/report/classifyEvidence.ts). docs/ai-rollout.md has the order in which
 * the two are switched over, and how to switch back.
 */

/**
 * Vercel kills the function at this many seconds — 60 is the Hobby ceiling. The
 * batch is sized so a cold Modal start plus its jobs fits comfortably inside it,
 * and STALE_AFTER recovers the batch if it does not.
 */
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // open locally, closed in prod
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Vercel Cron invokes a cron path with **GET**. This route exported only POST,
 * so the schedule — once it was in a file Vercel reads at all — would have been
 * answered 405 every night, with nothing raising it: a cron that 405s leaves no
 * row, no job and no error anywhere in the app. The whole
 * submit -> identify -> publish loop hung on this.
 *
 * A GET that mutates is not how anyone would design this. It is what the
 * platform requires, and every path below is behind CRON_SECRET, so the method
 * is not the thing standing between the internet and the queue. POST is kept
 * for an external scheduler (cron-job.org can do sub-daily, which Hobby cannot)
 * and for invoking a run by hand.
 */
export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}

/**
 * Never let this be prerendered. Route Handlers are uncached by default in this
 * version, and this one reads a header, so today it cannot be. But under Cache
 * Components a GET handler can be prerendered at build time — and a prerendered
 * classifier is a classifier that answers the cron instantly, from a static
 * file, forever, without touching the queue. Pinned rather than assumed.
 */
export const dynamic = "force-dynamic";

async function run(req: Request) {
  if (!authorised(req))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  // Deliberately small. This is read by a cron service, not a human, and a large
  // body is what made a timeout look like a broken endpoint.
  return Response.json(await classifyQueued());
}
