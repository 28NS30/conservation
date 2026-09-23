import { browserSupabase, PHOTO_BUCKET } from "@/lib/supabase/client";
import {
  listQueued,
  updateQueued,
  markUploaded,
  isPending,
  type QueuedReport,
} from "./queue";
import { withBase } from "@/lib/basePath";
import { turnstileEnabled } from "@/lib/turnstile";
import { ReportError, PHOTO_UPLOAD_FAILED } from "@/lib/report/errors";

/**
 * Runs the full submission pipeline for queued reports.
 *
 *   POST /api/uploads/sign  →  PUT photo(s) to Storage  →  POST /api/reports
 *
 * Safe to call repeatedly and concurrently-ish: each report carries a stable
 * `clientNonce`, and the API returns `{ duplicate: true }` rather than creating a
 * second row, so a retry after an ambiguous failure cannot duplicate anything.
 *
 * THE QUEUE NEEDS ITS OWN CHALLENGE. `/api/reports` rejects a submission with no
 * Turnstile token — `verifyTurnstile` returns false on a missing token whenever
 * TURNSTILE_SECRET_KEY is set — and the queued payload has never carried one,
 * because the form only obtains a token at submit time and the queue exists
 * precisely for the case where submit never happened. In production every
 * offline-queued report therefore 403'd, and a 403 is a 4xx, so it was written
 * off as permanently rejected. The one feature built for mountain roads with no
 * signal was discarding exactly those reports, silently, with the user shown a
 * "rejected" note they could do nothing about.
 *
 * So a token is now fetched per item at flush time (see QueueBanner, which owns
 * the widget). Two rules follow from a challenge being a property of the
 * *moment*, not of the report:
 *
 *   - No token yet is a SKIP, not an attempt. Attempts are a budget for things
 *     wrong with the report; spending one because a widget had not solved yet
 *     would grind an unsendable-right-now report down to `failed`.
 *   - A 403 challenge_failed is retryable, unlike every other 4xx. Tokens are
 *     single-use and expire in about five minutes, so one can go stale between
 *     being minted and being posted.
 */

export type FlushResult = {
  sent: number;
  failed: number;
  /** Held back for want of a challenge token. Costs no attempt. */
  skipped: number;
  remaining: number;
};

/** Supplies a fresh, single-use Turnstile token per queued report. */
export type TokenProvider = () => Promise<string | undefined>;

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
    // The queued blobs came out of the same canvas re-encode, so their own
    // type is the honest answer.
    body: JSON.stringify({
      count: pending.length,
      contentType: pending[0]?.type || "image/webp",
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ReportError(body.error ?? "sign_failed", res.status);
  }
  const { uploads } = (await res.json()) as {
    uploads: { path: string; token: string }[];
  };

  const storage = browserSupabase().storage.from(PHOTO_BUCKET);
  const paths = [...done];

  for (let i = 0; i < pending.length; i++) {
    const { path, token } = uploads[i];
    const { error } = await storage.uploadToSignedUrl(path, token, pending[i]);
    if (error) {
      console.error("[flush] photo upload:", error);
      throw new ReportError(PHOTO_UPLOAD_FAILED);
    }
    paths.push(path);
    // Persist after each photo so a mid-upload disconnect resumes from here.
    await updateQueued(item.id, { uploadedPaths: paths });
  }
  return paths;
}

async function sendOne(
  item: QueuedReport,
  getToken?: TokenProvider,
): Promise<"sent" | "failed" | "skipped"> {
  // Before anything is spent — no attempt, no upload. An unsolved challenge is a
  // reason to come back later, not a reason to give up on the report.
  const turnstileToken = await getToken?.();
  if (turnstileEnabled && !turnstileToken) {
    await updateQueued(item.id, { status: "queued", lastError: undefined });
    return "skipped";
  }

  await updateQueued(item.id, {
    status: "sending",
    attempts: item.attempts + 1,
  });

  try {
    const photoPaths = await uploadPhotos(item);

    const res = await fetch(withBase("/api/reports"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...item.payload,
        photoPaths,
        clientNonce: item.id,
        turnstileToken,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      // Kept as a receipt rather than deleted; see markUploaded. The status
      // comes along so the banner can offer the right link: a report that
      // landed as `pending` has no public page to open, and the receipt used
      // to link to one anyway.
      await markUploaded(item.id, String(data.id ?? ""), data.status);
      return "sent";
    }

    // A stale or already-spent token is not the report's fault, and the next
    // flush mints a new one. Fall through to the retry path.
    if (res.status === 403 && data.error === "challenge_failed") {
      throw new ReportError("challenge_failed", 403);
    }

    // Any other 4xx except rate-limiting means this report will never be
    // accepted — retrying forever would be pointless. Keep it visible as failed
    // so the user can see why rather than having it silently vanish.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      await updateQueued(item.id, {
        status: "failed",
        lastError: data.error ?? "unknown",
      });
      return "failed";
    }
    throw new ReportError(data.error ?? "unknown", res.status);
  } catch (e) {
    // A code, not a sentence. `lastError` is rendered by the queue banner, and
    // it used to hold English prose assembled here — "upload signing failed
    // (500)", "verification expired — will retry" — which was then shown
    // verbatim to a Taiwanese reporter. A code can be translated; a sentence
    // written in this file cannot.
    const code = e instanceof ReportError ? e.code : "unknown";
    if (!(e instanceof ReportError)) console.error("[flush]", e);
    const attempts = item.attempts + 1;
    await updateQueued(item.id, {
      status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
      lastError: code,
    });
    return "failed";
  }
}

export async function flushQueue(
  getToken?: TokenProvider,
): Promise<FlushResult> {
  // Coalesce overlapping triggers — page load, `online`, and visibilitychange can
  // easily fire together, and two concurrent flushes would double-upload photos.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    // `remaining` counts work, not receipts: an uploaded row is a record of
    // something that already succeeded, and counting it would leave the banner
    // claiming a report was still waiting after it had landed.
    const pending = async () => (await listQueued()).filter(isPending).length;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { sent, failed, skipped, remaining: await pending() };
    }

    for (const item of (await listQueued()).filter(isPending)) {
      if (item.status === "failed" && item.attempts >= MAX_ATTEMPTS) continue;
      const outcome = await sendOne(item, getToken);
      if (outcome === "sent") sent++;
      else if (outcome === "skipped") skipped++;
      else failed++;
    }

    return { sent, failed, skipped, remaining: await pending() };
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
export function startFlushTriggers(
  onResult?: (r: FlushResult) => void,
  getToken?: TokenProvider,
): () => void {
  const run = () => {
    void flushQueue(getToken).then((r) => {
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
    .then((reg) =>
      (
        reg as ServiceWorkerRegistration & {
          sync?: { register(tag: string): Promise<void> };
        }
      ).sync?.register("flush-reports"),
    )
    .catch(() => {});

  return () => {
    window.removeEventListener("online", run);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
