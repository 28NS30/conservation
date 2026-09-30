import { isReportPage } from "@conservation/shared";
import { IDENTIFY_LIMITS, SIGNED_IN_ADDRESS_FACTOR, withinBudgets, type Budget } from "@/lib/abuse";
import { addressKey, clientIp } from "@/lib/request";
import { currentUserId } from "@/lib/supabase/server";
import { identifyPhoto } from "@/lib/report/identify";
import { ModelRefused } from "@/lib/report/model";

/**
 * POST /api/identify — what the model says a photo shows, for the report form.
 *
 *   { imageBase64, page } → { band, suggestions, outsidePage }
 *
 * The team asked for the identification to appear as soon as a photo is added
 * (30 September 2026). The form sends the same downscaled copy it will upload,
 * already stripped of its metadata; nothing here stores it, and nothing here
 * names a species on any report: the reporter chooses.
 *
 * Each call reaches the GPU the project pays for, and this route has no
 * challenge in front of it, so it is rate-limited by address (more room for a
 * signed-in sender, as elsewhere) and capped for the whole site per day. Short
 * windows first, stopping at the first refusal (withinBudgets).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A downscaled photo is a few hundred KB; base64 of 1.5 MB is the ceiling. */
const MAX_BASE64 = 2_000_000;
/** Inside the function's limit, with room for a cold model service. */
const MODEL_TIMEOUT_MS = 55_000;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  const { imageBase64, page } = (body ?? {}) as { imageBase64?: unknown; page?: unknown };
  if (!isReportPage(page)) return Response.json({ error: "bad_page" }, { status: 400 });
  if (typeof imageBase64 !== "string" || imageBase64.length === 0 || imageBase64.length > MAX_BASE64)
    return Response.json({ error: "bad_image" }, { status: 400 });
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64))
    return Response.json({ error: "bad_image" }, { status: 400 });

  if (!process.env.ML_ENDPOINT_URL || !process.env.ML_ENDPOINT_TOKEN)
    return Response.json({ error: "unavailable" }, { status: 503 });

  const who = addressKey(clientIp(req));
  const userId = await currentUserId();
  const factor = userId ? SIGNED_IN_ADDRESS_FACTOR : 1;
  const L = IDENTIFY_LIMITS;
  const budgets: Budget[] = [
    { key: `identify-burst:${who}`, windowSeconds: L.burst.windowSeconds, budget: L.burst.budget * factor },
    { key: `identify-daily:${who}`, windowSeconds: L.daily.windowSeconds, budget: L.daily.budget * factor },
    { key: "identify-site", windowSeconds: L.siteDaily.windowSeconds, budget: L.siteDaily.budget },
  ];
  if (!(await withinBudgets(budgets))) return Response.json({ error: "rate_limited" }, { status: 429 });

  try {
    const result = await identifyPhoto(imageBase64, page, MODEL_TIMEOUT_MS);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof ModelRefused) return Response.json({ error: "unreadable" }, { status: 422 });
    console.error("[identify]", (e as Error).message);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
