import "server-only";

import { createClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET } from "./client";

export { PHOTO_BUCKET };

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * `server-only` above makes importing this from a client component a build
 * error — the failure mode otherwise is shipping a key that can read every
 * report's true coordinate to the browser.
 */
export function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Confirm an object the client claims to have uploaded actually exists, and
 * report its real size and type.
 *
 * The client tells us which paths it uploaded; without this it could reference
 * paths it never wrote. Storage's own `allowed_mime_types` and `file_size_limit`
 * are the primary guard — this confirms the guard actually fired.
 */
export async function statUploadedPhoto(
  path: string,
): Promise<{ bytes: number; contentType: string } | null> {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const name = slash === -1 ? path : path.slice(slash + 1);

  const { data, error } = await serviceSupabase()
    .storage.from(PHOTO_BUCKET)
    .list(dir, { search: name, limit: 1 });

  if (error || !data?.length) return null;
  const entry = data.find((e) => e.name === name);
  if (!entry?.metadata) return null;

  const meta = entry.metadata as { size?: number; mimetype?: string };
  if (typeof meta.size !== "number" || meta.size <= 0) return null;
  return { bytes: meta.size, contentType: meta.mimetype ?? "application/octet-stream" };
}

/** Signed read URL for a stored photo. The bucket is private. */
export async function signedPhotoUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const { data } = await serviceSupabase()
    .storage.from(PHOTO_BUCKET)
    .createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

/**
 * Fetch a stored photo's bytes with the service role.
 *
 * Used by the classification worker so inference never depends on the photo
 * being publicly reachable — see the note in app/api/jobs/classify/route.ts.
 */
export async function downloadPhoto(path: string): Promise<Buffer | null> {
  const { data, error } = await serviceSupabase().storage.from(PHOTO_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
