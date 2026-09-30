import {
  listQueued,
  getQueued,
  updateQueued,
  markUploaded,
  isPending,
  type QueuedReport,
} from "./queue";
import { withBase } from "@/lib/basePath";
import { turnstileEnabled } from "@/lib/turnstile";
import { ReportError, NETWORK, isNetworkFailure } from "@/lib/report/errors";
import { uploadPhoto } from "@/lib/report/upload";

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

/**
 * How long one request may go unanswered before the flush gives up on it.
 *
 * On one bar of signal a request can simply never come back, and a flush
 * waiting on it holds the queue: every later trigger — `online`, the tab
 * coming back, the banner's own send — is coalesced into the one that is
 * stuck, so nothing leaves the phone until the page is reloaded. Generous,
 * because a cold server is slow too; and safe to cut short, because the
 * report's nonce makes the retry of a request that did land a duplicate the
 * server answers with the row it already has.
 */
const REQUEST_TIMEOUT_MS = 30_000;

let inFlight: Promise<FlushResult> | null = null;
/** Whether the flush in flight can get challenge tokens. See flushQueue. */
let inFlightHasToken = false;
/** The report being sent right now, which the banner will not let be discarded. */
let sending: string | null = null;

export function currentlySending(): string | null {
  return sending;
}

function setSending(id: string | null) {
  sending = id;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("conservation:queue-changed"));
}

async function uploadPhotos(item: QueuedReport): Promise<string[]> {
  // Resume rather than restart: re-uploading photos that already landed would
  // orphan objects in Storage on every retry.
  const done = item.uploadedPaths.slice(0, item.photos.length);
  const pending = item.photos.slice(done.length);
  if (pending.length === 0) return done;

  const res = await fetch(withBase("/api/uploads/sign"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

  const paths = [...done];

  for (let i = 0; i < pending.length; i++) {
    const { path, token } = uploads[i];
    // NETWORK when the photo never reached Storage, which costs no attempt.
    await uploadPhoto(path, token, pending[i]);
    paths.push(path);
    // Persist after each photo so a mid-upload disconnect resumes from here.
    await updateQueued(item.id, { uploadedPaths: paths });
  }
  return paths;
}

/**
 * What became of one report.
 *
 * `limited` is a 429: the sender's budget is spent for now, so every report
 * after this one would be refused too, and the flush stops. It costs no
 * attempt. It used to cost one, and a phone with a dozen reports saved on a
 * long road ground the later ones down to `failed` in a few flushes (security
 * audit, 29 September 2026).
 */
type Outcome = "sent" | "failed" | "skipped" | "limited";

async function sendOne(
  item: QueuedReport,
  getToken?: TokenProvider,
  photosRetried = false,
): Promise<Outcome> {
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

    // Discarded while its photos were going up: it is not filed. The row is
    // gone, so nothing below could record the outcome, and a report the
    // reporter was told was deleted used to be published anyway.
    if (!(await getQueued(item.id))) return "skipped";

    const res = await fetch(withBase("/api/reports"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
      await markUploaded(item.id, String(data.id ?? ""), data.status, data.visible !== false);
      return "sent";
    }

    if (res.status === 429) throw new ReportError("rate_limited", 429);

    // Its photos are gone from Storage: uploaded on an earlier try whose post
    // never landed, then collected as orphans. They are still on this phone,
    // so upload them again, once, instead of failing a sound report for good.
    // Whenever this send carried photos, not only when the copy the flush
    // started from already had uploads: a report whose photos went up in this
    // very send was otherwise failed for good by one bad answer. (A Storage
    // that cannot be asked is a 503 now, retried like any server error.)
    if (res.status === 400 && data.error === "photo_missing" && !photosRetried && photoPaths.length) {
      const again = { ...item, uploadedPaths: [], attempts: item.attempts + 1 };
      await updateQueued(item.id, { uploadedPaths: [] });
      return sendOne(again, getToken, true);
    }

    // Saved under another account than the one signed in now, or under none.
    // Not filed under the wrong person: it waits, at no cost, for its own
    // account, and says so. The reporter can also discard it.
    if (res.status === 409 && data.error === "signed_in_as_someone_else") {
      await updateQueued(item.id, {
        status: "queued",
        attempts: item.attempts,
        lastError: data.error,
      });
      return "skipped";
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
    //
    // A request that never reached us — `fetch` rejects with a TypeError when
    // there is no network — is not something wrong with the report, and it
    // used to be shown as "something went wrong at our end", under a banner
    // that had just said there was no signal. It has its own code, and like a
    // missing token it costs no attempt: `navigator.onLine` says true on one
    // bar of signal, or on a captive portal, and eight such flushes would
    // otherwise grind a perfectly good report down to `failed`. A request
    // that went out and never came back (REQUEST_TIMEOUT_MS) is the same.
    //
    // A photograph that never reached Storage is the same (lib/report/upload.ts).
    const network = isNetworkFailure(e);
    const limited = e instanceof ReportError && e.code === "rate_limited";
    const code = network ? NETWORK : e instanceof ReportError ? e.code : "unknown";
    if (!(e instanceof ReportError) && !network) console.error("[flush]", e);
    const attempts = network || limited ? item.attempts : item.attempts + 1;
    await updateQueued(item.id, {
      status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
      attempts,
      lastError: code,
    });
    return limited ? "limited" : "failed";
  }
}

export async function flushQueue(
  getToken?: TokenProvider,
): Promise<FlushResult> {
  // Coalesce overlapping triggers — page load, `online`, and visibilitychange can
  // easily fire together, and two concurrent flushes would double-upload photos.
  //
  // Except into a flush that cannot get a token. The service worker's
  // Background Sync ping runs one (components/ServiceWorker.tsx), and when a
  // challenge is required it skips every report. The banner's own flush often
  // starts a moment later — the ping is registered by the same mount — and
  // folded into the tokenless one it did nothing: the report sat waiting on a
  // page that could have sent it, until the page was opened again. So a flush
  // that can get tokens waits for that one to finish, then runs.
  if (inFlight) {
    if (!getToken || inFlightHasToken) return inFlight;
    await inFlight.catch(() => undefined);
    return flushQueue(getToken);
  }

  const run = (async () => {
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
      // `failed` is final: refused by the server for something about the
      // report, or out of attempts. Sending it again on every flush spent the
      // sender's rate limit on answers already known, so it stays on screen,
      // to be read and discarded, and is not sent.
      if (item.status === "failed") continue;
      setSending(item.id);
      let outcome: Outcome;
      try {
        outcome = await sendOne(item, getToken);
      } finally {
        setSending(null);
      }
      if (outcome === "sent") sent++;
      else if (outcome === "skipped") skipped++;
      else failed++;
      if (outcome === "limited") break;
    }

    return { sent, failed, skipped, remaining: await pending() };
  })();
  inFlight = run;
  inFlightHasToken = Boolean(getToken);

  try {
    return await run;
  } finally {
    // Only this flush's own slot: a caller that waited for it may already
    // have started the next one.
    if (inFlight === run) {
      inFlight = null;
      inFlightHasToken = false;
    }
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
