import type { Category, ReportPage } from "@conservation/shared";
import { offlineDb, readExisting, QUEUE_STORE as STORE } from "./db.ts";

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
    /**
     * The page it was filed on, which the server holds the category and the
     * species to. Absent on rows queued before the three pages existed; the
     * server then takes the page the category belongs to.
     */
    page?: ReportPage;
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
    /**
     * The account signed in when the report was saved, or "anonymous". The
     * queue is per device, not per account, and the server used to file a
     * report under whoever was signed in when it finally sent: on a shared
     * phone, one person's report (their email and notes with it) under
     * another's name. The server holds the report to this now. Absent on rows
     * saved by an older build, which are sent as before.
     */
    filedBy?: string;
    /** A moderator's test (migration 0018), saved on the phone as one. */
    test?: boolean;
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
  /** Set once accepted, so the banner can link to the record. */
  reportId?: string;
  /**
   * What the server said it did with it: `published` or `pending`.
   *
   * Kept because the banner's receipt link used to go to `/reports/{id}` for
   * every accepted report, and that page has no row for one that was held — so
   * a reporter who watched their queue drain on a mountain road followed the
   * link and got a 404. Optional, and absent on rows queued by an older build,
   * which is why the banner treats "no status" as "do not offer a link".
   *
   * No VERSION bump: IndexedDB stores structured clones and enforces no schema,
   * so a new field on the stored object needs no upgrade. Only a new store or
   * index would.
   */
  serverStatus?: string;
  /**
   * Whether the server said the record reached the public record list. A
   * record of a species whose coordinates TaiCOL withholds is published but
   * shown nowhere, and its link was a 404. Absent on older rows: treated as
   * visible, which is what the banner assumed before.
   */
  serverVisible?: boolean;
  sentAt?: number;
  /**
   * When the server last answered this report with anything but acceptance,
   * and how many such answers it has had in a row. Together they decide when
   * the flush asks again (retryAt in flush.ts), so a report the server keeps
   * failing on is not sent on every trigger. A try that never reached the
   * server sets neither: the next sign of signal should send it at once.
   */
  lastTriedAt?: number;
  retries?: number;
  /**
   * When the reporter last asked for it to be tried again (the banner's 再試一次).
   * The fourteen days after which the queue stops trying count from here, or
   * from `createdAt` when it was never asked.
   */
  retryFrom?: number;
  /**
   * The species as the form showed it, for this phone's list of the reports it
   * sent (sent.ts). Beside the payload, not in it: the payload is what the
   * server is sent, and it has no field for this.
   */
  label?: string | null;
};

/** Still to send. `uploaded` rows are receipts, not work. */
export const isPending = (r: QueuedReport) => r.status !== "uploaded";

const db = offlineDb;

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

export async function getQueued(id: string): Promise<QueuedReport | undefined> {
  return (await (await db()).get(STORE, id)) as QueuedReport | undefined;
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
 * Put a report the queue stopped trying back in line, its waits forgotten.
 *
 * `failed` used to be the end: the reporter could read why and discard it, and
 * nothing else. A server that was down for a morning, or a report that sat on a
 * phone past the fourteen days, deserves another go when its reporter asks.
 */
export async function retryQueued(id: string): Promise<void> {
  await updateQueued(id, {
    status: "queued",
    attempts: 0,
    retries: 0,
    lastTriedAt: undefined,
    lastError: undefined,
    retryFrom: Date.now(),
  });
}

/**
 * How many reports are still to send, for the reminder on every page.
 *
 * Read without opening the database for writing (readExisting in db.ts), so a
 * phone that has never queued anything gets no database from being reminded.
 */
export async function countWaiting(): Promise<number> {
  return readExisting(async (conn) => {
    if (!conn.objectStoreNames.contains(STORE)) return 0;
    const all = (await conn.getAll(STORE)) as QueuedReport[];
    return all.filter(isPending).length;
  }, 0);
}

/**
 * Accepted. Keep the receipt, drop the payload.
 *
 * The photographs are the whole weight of a queued report and they are on the
 * server now, so holding them to show a tick would trade the user's storage for
 * a line of text. The row that remains is an id, a timestamp and a link.
 */
export async function markUploaded(
  id: string,
  reportId: string,
  serverStatus?: string,
  serverVisible?: boolean,
): Promise<void> {
  const conn = await db();
  const existing = (await conn.get(STORE, id)) as QueuedReport | undefined;
  if (!existing) return;
  await conn.put(STORE, {
    ...existing,
    status: "uploaded",
    reportId,
    serverStatus,
    serverVisible,
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
