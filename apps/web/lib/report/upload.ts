import { browserSupabase, PHOTO_BUCKET } from "@/lib/supabase/client";
import { ReportError, PHOTO_UPLOAD_FAILED, NETWORK } from "./errors";

/**
 * How long one photograph may take to reach the bucket before it is treated
 * as lost signal. A downscaled WebP is a few hundred KB, so this is minutes of
 * one bar; and a flush waiting on an upload that never answers holds the
 * whole queue, as REQUEST_TIMEOUT_MS in lib/offline/flush.ts explains.
 */
export const UPLOAD_TIMEOUT_MS = 90_000;

/**
 * Put one photograph at a signed upload URL, and say why if it did not land.
 *
 * supabase-js resolves with `{ error }` rather than rejecting, and turns a
 * `fetch` that failed for want of a network into a StorageUnknownError. Both
 * callers used to read every such error as a refused photograph, so no signal
 * told the reporter to take their photos off and cost the queue an attempt. A
 * failure that never reached Storage is NETWORK now, as a failed `fetch` is
 * everywhere else; one Storage answered is PHOTO_UPLOAD_FAILED.
 *
 * The call takes no AbortSignal, so a hung upload is abandoned rather than
 * cancelled. If it lands later, its object is an orphan the cleanup job
 * deletes after a week.
 */
export async function uploadPhoto(
  path: string,
  token: string,
  blob: Blob,
  timeoutMs = UPLOAD_TIMEOUT_MS,
): Promise<void> {
  const storage = browserSupabase().storage.from(PHOTO_BUCKET);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReportError(NETWORK)), timeoutMs);
  });
  try {
    const { error } = await Promise.race([
      storage.uploadToSignedUrl(path, token, blob),
      timeout,
    ]);
    if (!error) return;
    console.error("[upload] photo:", error);
    throw new ReportError(neverArrived(error) ? NETWORK : PHOTO_UPLOAD_FAILED);
  } catch (e) {
    // `fetch` itself can still throw past supabase-js on some browsers.
    if (e instanceof TypeError) throw new ReportError(NETWORK);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Storage never answered: no status, and the cause was the request itself. */
function neverArrived(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const e = error as { name?: string; status?: unknown; originalError?: unknown };
  if (e.name === "StorageUnknownError") return true;
  return e.status === undefined && e.originalError instanceof TypeError;
}
