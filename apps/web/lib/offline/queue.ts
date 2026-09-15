import { openDB, type IDBPDatabase } from "idb";
import type { Category } from "@conservation/shared";

/**
 * Offline submission queue.
 *
 * Roadkill happens on mountain roads, which is exactly where there is no signal,
 * so a reporting flow that requires connectivity fails precisely where it matters.
 *
 * The queue holds the *inputs*, not a prepared request. Submission is three
 * network steps — sign, upload photos, post the report — and being offline breaks
 * the first, so the whole pipeline has to run at flush time. That also rules out
 * pre-signing upload URLs at queue time: they are short-lived and a report queued
 * overnight would flush against an expired one.
 */

const DB_NAME = "conservation-offline";
const STORE = "pendingReports";
const VERSION = 1;

export type QueuedReport = {
  /**
   * Doubles as the submission's `clientNonce`, generated once at queue time.
   *
   * This is what makes retrying safe: the reports table has a unique index on
   * client_nonce and the API returns `{ duplicate: true }` for a repeat, so a
   * retry after an ambiguous timeout can never create a second report.
   */
  id: string;
  createdAt: number;
  payload: {
    category: Category;
    lng: number;
    lat: number;
    observedAt: string;
    /**
     * How good the device said the fix was, in metres.
     *
     * Asked for by name in the team's field list, and it is the difference
     * between a 20 m reading under open sky and a 2 km one in a valley — a
     * record whose coordinate cannot be trusted to a kilometre is a different
     * record. Carried only when the coordinate came from the device: a pin the
     * reporter dragged has no accuracy to report, and inventing one would be
     * worse than leaving it empty.
     */
    accuracyM?: number;
    /** What the reporter named at capture time, if anything. */
    taxonId?: number;
    /** They looked and could not name it. See reportSubmissionSchema. */
    taxonUnknown?: boolean;
    notes?: string;
    contactEmail?: string;
  };
  photos: Blob[];
  /** Paths already uploaded, so a partial upload resumes instead of re-uploading. */
  uploadedPaths: string[];
  attempts: number;
  lastError?: string;
  /**
   * The team asked for pending, uploading, uploaded and failed. The first three
   * are `queued`, `sending` and `uploaded`; the missing one was `uploaded`,
   * because a sent report was deleted outright and the banner it had been
   * sitting in simply vanished. Someone who queues a report on a mountain road
   * and watches it go deserves to see that it went.
   */
  status: "queued" | "sending" | "uploaded" | "failed";
  /** Set once accepted, so the banner can link to the published record. */
  reportId?: string;
  sentAt?: number;
};

/** Still to send. `uploaded` rows are receipts, not work. */
export const isPending = (r: QueuedReport) => r.status !== "uploaded";

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(database, oldVersion) {
        // Guarded so a later VERSION bump does not re-create an existing store,
        // which throws ConstraintError and leaves listQueued() rejecting with
        // nothing catching it — i.e. a silent, total loss of the queue UI.
        if (oldVersion < 1) {
          const store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueue(
  item: Omit<QueuedReport, "createdAt" | "attempts" | "status" | "uploadedPaths">,
): Promise<QueuedReport> {
  const record: QueuedReport = {
    ...item,
    createdAt: Date.now(),
    uploadedPaths: [],
    attempts: 0,
    status: "queued",
  };
  await (await db()).put(STORE, record);
  return record;
}

export async function listQueued(): Promise<QueuedReport[]> {
  const all = (await (await db()).getAll(STORE)) as QueuedReport[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateQueued(id: string, patch: Partial<QueuedReport>): Promise<void> {
  const conn = await db();
  const existing = (await conn.get(STORE, id)) as QueuedReport | undefined;
  if (!existing) return;
  await conn.put(STORE, { ...existing, ...patch });
}

export async function removeQueued(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}

/**
 * Accepted. Keep the receipt, drop the payload.
 *
 * The photographs are the whole weight of a queued report and they are on the
 * server now, so holding them to show a tick would trade the user's storage for
 * a line of text. The row that remains is an id, a timestamp and a link.
 */
export async function markUploaded(id: string, reportId: string): Promise<void> {
  const conn = await db();
  const existing = (await conn.get(STORE, id)) as QueuedReport | undefined;
  if (!existing) return;
  await conn.put(STORE, {
    ...existing,
    status: "uploaded",
    reportId,
    sentAt: Date.now(),
    photos: [],
    lastError: undefined,
  });
}

/** Drop receipts older than `maxAgeMs`. Called on load; nothing else expires. */
export async function purgeUploaded(maxAgeMs: number): Promise<void> {
  const conn = await db();
  for (const r of (await conn.getAll(STORE)) as QueuedReport[]) {
    if (r.status === "uploaded" && Date.now() - (r.sentAt ?? 0) > maxAgeMs)
      await conn.delete(STORE, r.id);
  }
}

export async function queueSize(): Promise<number> {
  return (await db()).count(STORE);
}

/**
 * Ask the browser not to evict our storage.
 *
 * Without this the queue is best-effort: "clear site data" destroys it, and iOS
 * evicts IndexedDB for sites unused for roughly seven days — long enough that a
 * report queued on a weekend trip can vanish before the user reopens the app.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
