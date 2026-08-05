import { randomUUID } from "node:crypto";
import { serviceSupabase, PHOTO_BUCKET } from "@/lib/supabase/service";
import { withinRateLimit } from "@/lib/abuse";
import { MAX_PHOTOS } from "@conservation/shared";
import { clientIp } from "@/lib/request";

/**
 * Mint short-lived signed upload URLs.
 *
 * Photos go straight from the browser to Supabase Storage rather than through
 * this function: Vercel caps request bodies at 4.5 MB, and proxying image bytes
 * through a serverless function wastes duration for no benefit.
 *
 * Paths are server-generated with no user-controlled component, so a client
 * cannot direct an upload at an arbitrary key.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);

  // Signing is itself an abusable endpoint — an unlimited supply of upload URLs
  // is a way to fill the bucket without ever submitting a report.
  if (!(await withinRateLimit(`sign:${ip}`, 300, 40))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let count = 1;
  try {
    const body = (await req.json()) as { count?: unknown };
    if (typeof body.count === "number") count = body.count;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  if (!Number.isInteger(count) || count < 1 || count > MAX_PHOTOS) {
    return Response.json({ error: "bad_count" }, { status: 400 });
  }

  const storage = serviceSupabase().storage.from(PHOTO_BUCKET);
  const now = new Date();
  const prefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const uploads: { path: string; token: string }[] = [];
  for (let i = 0; i < count; i++) {
    const path = `${prefix}/${randomUUID()}.webp`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[uploads/sign]", error);
      return Response.json({ error: "sign_failed" }, { status: 500 });
    }
    uploads.push({ path: data.path, token: data.token });
  }

  return Response.json({ uploads });
}
