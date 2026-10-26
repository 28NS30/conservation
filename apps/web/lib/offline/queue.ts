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
   * When the server first answered it so, since it was saved or since its
   * reporter last pressed 再試一次. The fourteen days after which the queue
   * stops trying count from here, not from when it was saved: a report carried
   * for three weeks on a trip with no signal at all has not been tried for
   * three weeks, and was given up on at its very first 503.
   */
  firstAnsweredAt?: number;
  /**
   * When the reporter's 刪除 becomes final, unless they press 復原 first.
   *
   * On the row, set the moment 刪除 is pressed, rather than in a timer on the
   * page. The undo used to live in the page alone, and a page closed, reloaded
   * or evicted during it never deleted the report — and nothing said it was
   * discarded, so the next flush sent the report its reporter had thrown away.
   * Now no flush in any tab sends a row with this set, the banner shows it as
   * discarded with its undo for whatever is left of the few seconds, and once
   * they are up the next look at the queue deletes it (finishDiscards), here
   * or in any other tab, or on any page through the reminder. Nothing is
   * deleted before then, so a reporter whose page went away mid-undo can still
   * take it back when it opens again.
   */
  discardAt?: number;
  /**
   * The species as the form showed it, for this phone's list of the reports it
   * sent (sent.ts). Beside the payload, not in it: the payload is what the
   * server is sent, and it has no field for this.
   */
  label?: string | null;
};

/** Still to send. `uploaded` rows are receipts, not work. */
export const isPending = (r: QueuedReport) => r.status !== "uploaded";

/** Still to send, and not on its way to being discarded. What is counted. */
export const isWaiting = (r: QueuedReport) => isPending(r) && r.discardAt === undefined;

/** A discard that has become final. */
const discardDue = (r: QueuedReport, now: number) =>
  r.discardAt !== undefined && r.discardAt <= now;

const db = offlineDb;

/**
 * Tell this page's banner and reminder to look again.
 *
 * From every change to the queue, so that nothing has to remember to: the
 * banner's 刪除, 復原 and 再試一次 used to change the queue without a word, and
 * the reminder went on saying "1 筆通報還沒送出" on every page after the last
 * report had been discarded. Looking again changes nothing, so this cannot
 * loop: the banner's own refresh writes only through finishDiscards, which
 * says so only when it deleted something.
 */
function changed() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("conservation:queue-changed"));
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
  changed();
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
  changed();
}

export async function removeQueued(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
  changed();
}

/** The reporter pressed 刪除: final at `at`, unless they undo it. See discardAt. */
export async function discardQueued(id: string, at: number): Promise<void> {
  await updateQueued(id, { discardAt: at });
}

/** The reporter pressed 復原. */
export async function keepQueued(id: string): Promise<void> {
  await updateQueued(id, { discardAt: undefined });
}

/** Delete every report whose discard has become final. Says how many. */
export async function finishDiscards(now = Date.now()): Promise<number> {
  const conn = await db();
  let deleted = 0;
  for (const r of (await conn.getAll(STORE)) as QueuedReport[]) {
    if (!discardDue(r, now)) continue;
    await conn.delete(STORE, r.id);
    deleted++;
  }
  if (deleted) changed();
  return deleted;
}

/**
 * Put a report the queue stopped trying back in line, its waits forgotten.
 *
 * `failed` used to be the end: the reporter could read why and discard it, and
 * nothing else. A server that was down for a morning, or a report the server
 * failed on for fourteen days, deserves another go when its reporter asks; the
 * fourteen days start again from the next answer.
 */
export async function retryQueued(id: string): Promise<void> {
  await updateQueued(id, {
    status: "queued",
    attempts: 0,
    retries: 0,
    lastTriedAt: undefined,
    lastError: undefined,
    firstAnsweredAt: undefined,
  });
}

/**
 * How many reports are still to send, for the reminder on every page.
 *
 * Through readExisting (db.ts), which never creates or upgrades the database,
 * so a phone that has never queued anything gets no database from being
 * reminded. It does finish the discards that are due, as the banner does: the
 * photographs and notes of a report its reporter threw away should not stay
 * on the phone until a report page happens to be opened again.
 */
export async function countWaiting(now = Date.now()): Promise<number> {
  return readExisting(async (conn) => {
    if (!conn.objectStoreNames.contains(STORE)) return 0;
    const all = (await conn.getAll(STORE)) as QueuedReport[];
    for (const r of all) if (discardDue(r, now)) await conn.delete(STORE, r.id);
    return all.filter(isWaiting).length;
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
    // Filed, so there is nothing left to discard; a 刪除 pressed in another
    // tab in the second it took is answered by the receipt instead.
    discardAt: undefined,
  });
  changed();
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
