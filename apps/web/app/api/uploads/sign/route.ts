import { randomUUID } from "node:crypto";
import { serviceSupabase, PHOTO_BUCKET } from "@/lib/supabase/service";
import { withinBudgets, SIGN_LIMITS, SIGNED_IN_ADDRESS_FACTOR, type Budget } from "@/lib/abuse";
import { currentUserId } from "@/lib/supabase/server";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_PHOTOS,
  imageExtension,
  isAcceptedImageType,
} from "@conservation/shared";
import { addressKey, clientIp } from "@/lib/request";

/**
 * Mint short-lived signed upload URLs.
 *
 * Photos go straight from the browser to Supabase Storage rather than through
 * this function: Vercel caps request bodies at 4.5 MB, and proxying image bytes
 * through a serverless function wastes duration for no benefit.
 *
 * Paths are server-generated with no user-controlled component, so a client
 * cannot direct an upload at an arbitrary key. The only thing the client gets
 * to influence is the EXTENSION, and only by naming one of three accepted
 * types — the random UUID and the date prefix are still ours.
 *
 * It used to be `.webp` always, which was true while the web form was the only
 * caller: its canvas re-encode always produced WebP. An iOS client cannot,
 * `expo-image-manipulator` being Android-only for that format, so the name and
 * the bytes were about to stop agreeing. Nothing serves from the extension —
 * Supabase returns the content type recorded at upload — so this was never
 * going to break a page. It was going to make every object in the bucket lie
 * about itself.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);

  // Signing is itself an abusable endpoint — an unlimited supply of upload URLs
  // is a way to fill the bucket without ever submitting a report.
  //
  // Counted as the report route counts: a signed-in sender's address gets
  // more room, because a class on one school network signs photos together,
  // and their account has its own budget beside it; and a burst that is
  // refused is not counted against the day (withinBudgets). Signing used to
  // allow a class of twelve eight photos between them while the report route
  // accepted thirty reports (review of the security fixes, 30 September 2026).
  const who = addressKey(ip);
  const userId = await currentUserId();
  const factor = userId ? SIGNED_IN_ADDRESS_FACTOR : 1;
  const budgets: Budget[] = [
    { key: `sign-burst:${who}`, windowSeconds: SIGN_LIMITS.burst.windowSeconds, budget: SIGN_LIMITS.burst.budget * factor },
    ...(userId
      ? [{ key: `sign-burst:user:${userId}`, windowSeconds: SIGN_LIMITS.burst.windowSeconds, budget: SIGN_LIMITS.burst.budget }]
      : []),
    { key: `sign-daily:${who}`, windowSeconds: SIGN_LIMITS.daily.windowSeconds, budget: SIGN_LIMITS.daily.budget * factor },
    ...(userId
      ? [{ key: `sign-daily:user:${userId}`, windowSeconds: SIGN_LIMITS.daily.windowSeconds, budget: SIGN_LIMITS.daily.budget }]
      : []),
  ];
  if (!(await withinBudgets(budgets))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let count = 1;
  // What the client is about to upload. The web form always sends WebP, so the
  // default keeps every existing caller working; an iOS client cannot send
  // WebP at all, because expo-image-manipulator only writes it on Android.
  let contentType: string = "image/webp";
  try {
    const body = (await req.json()) as { count?: unknown; contentType?: unknown };
    if (typeof body.count === "number") count = body.count;
    if (body.contentType !== undefined) {
      if (!isAcceptedImageType(body.contentType)) {
        return Response.json(
          { error: "photo_bad_type", accepted: ACCEPTED_IMAGE_TYPES },
          { status: 400 },
        );
      }
      contentType = body.contentType;
    }
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
    const path = `${prefix}/${randomUUID()}.${imageExtension(contentType)}`;
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[uploads/sign]", error);
      return Response.json({ error: "sign_failed" }, { status: 500 });
    }
    uploads.push({ path: data.path, token: data.token });
  }

  return Response.json({ uploads });
}
