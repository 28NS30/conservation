import { browserSupabase, PHOTO_BUCKET } from "@/lib/supabase/client";
import { listQueued, updateQueued, removeQueued, type QueuedReport } from "./queue";
import { withBase } from "@/lib/basePath";

/**
 * Runs the full submission pipeline for queued reports.
 *
 *   POST /api/uploads/sign  →  PUT photo(s) to Storage  →  POST /api/reports
 *
 * Safe to call repeatedly and concurrently-ish: each report carries a stable
 * `clientNonce`, and the API returns `{ duplicate: true }` rather than creating a
 * second row, so a retry after an ambiguous failure cannot duplicate anything.
 */

export type FlushResult = { sent: number; failed: number; remaining: number };

const MAX_ATTEMPTS = 8;

let inFlight: Promise<FlushResult> | null = null;

async function uploadPhotos(item: QueuedReport): Promise<string[]> {
  // Resume rather than restart: re-uploading photos that already landed would
  // orphan objects in Storage on every retry.
  const done = item.uploadedPaths.slice(0, item.photos.length);
  const pending = item.photos.slice(done.length);
  if (pending.length === 0) return done;

  const res = await fetch(withBase("/api/uploads/sign"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count: pending.length }),
  });
  if (!res.ok) throw new Error(`upload signing failed (${res.status})`);
  const { uploads } = (await res.json()) as { uploads: { path: string; token: string }[] };

  const storage = browserSupabase().storage.from(PHOTO_BUCKET);
  const paths = [...done];

  for (let i = 0; i < pending.length; i++) {
    const { path, token } = uploads[i];
    const { error } = await storage.uploadToSignedUrl(path, token, pending[i]);
    if (error) throw new Error(`photo upload failed: ${error.message}`);
    paths.push(path);
    // Persist after each photo so a mid-upload disconnect resumes from here.
    await updateQueued(item.id, { uploadedPaths: paths });
  }
  return paths;
}

async function sendOne(item: QueuedReport): Promise<"sent" | "failed"> {
  await updateQueued(item.id, { status: "sending", attempts: item.attempts + 1 });

  try {
    const photoPaths = await uploadPhotos(item);

    const res = await fetch(withBase("/api/reports"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...item.payload, photoPaths, clientNonce: item.id }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      await removeQueued(item.id);
      return "sent";
    }

    // A 4xx other than rate-limiting means this report will never be accepted —
    // retrying forever would be pointless. Keep it visible as failed so the user
    // can see why rather than having it silently vanish.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      await updateQueued(item.id, {
        status: "failed",
        lastError: data.error ?? `rejected (${res.status})`,
      });
      return "failed";
    }
    throw new Error(data.error ?? `submission failed (${res.status})`);
  } catch (e) {
    const message = (e as Error).message.slice(0, 300);
    const attempts = item.attempts + 1;
    await updateQueued(item.id, {
      status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
      lastError: message,
    });
    return "failed";
  }
}

export async function flushQueue(): Promise<FlushResult> {
  // Coalesce overlapping triggers — page load, `online`, and visibilitychange can
  // easily fire together, and two concurrent flushes would double-upload photos.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let sent = 0;
    let failed = 0;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { sent, failed, remaining: (await listQueued()).length };
    }

    for (const item of await listQueued()) {
      if (item.status === "failed" && item.attempts >= MAX_ATTEMPTS) continue;
      const outcome = await sendOne(item);
      if (outcome === "sent") sent++;
      else failed++;
    }

    return { sent, failed, remaining: (await listQueued()).length };
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Wire up every flush trigger available.
 *
 * Background Sync would flush with the tab closed, but Safari and iOS do not
 * implement it and iOS share in Taiwan is high — so the mechanism that actually
 * carries the feature is "flush when the user next opens the app". The UI says so
 * rather than implying reports send themselves.
 */
export function startFlushTriggers(onResult?: (r: FlushResult) => void): () => void {
  const run = () => {
    void flushQueue().then((r) => {
      if (r.sent > 0 || r.failed > 0) onResult?.(r);
    });
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") run();
  };

  window.addEventListener("online", run);
  document.addEventListener("visibilitychange", onVisible);
  run();

  // Bonus path on Chromium: flushes even if the tab is closed.
  void navigator.serviceWorker?.ready
    .then((reg) => (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register("flush-reports"))
    .catch(() => {});

  return () => {
    window.removeEventListener("online", run);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
