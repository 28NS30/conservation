import { openDB, type IDBPDatabase } from "idb";

/**
 * The one IndexedDB database this site keeps on a device, and its stores.
 *
 *   pendingReports  the offline queue (queue.ts): reports waiting for signal,
 *                   and for a day the receipts of ones that went
 *   drafts          the photographs of a report still being filled in
 *                   (drafts.ts); the typed fields are in sessionStorage
 *   sent            the reports sent from this device, for /me (sent.ts)
 *
 * VERSION 2 added `drafts` and `sent`. A version is needed for a new store and
 * for nothing else: IndexedDB keeps structured clones and enforces no schema
 * on what is in a store, so a new field on a stored object needs no upgrade.
 * Each store is created only if it is not there, whatever version the
 * database says it is at, so opening an existing database never creates a
 * store twice — that throws ConstraintError, and listQueued() rejecting with
 * nothing to catch it is a silent, total loss of the queue on screen — and a
 * database left at version 1 with no queue in it gets one. The queue is
 * created exactly as version 1 created it, so a phone that has only ever had
 * this build has the same store a phone that upgraded keeps, rows and all
 * (e2e/offline.spec.mjs opens a version-1 database with a report in it).
 *
 * AN OLDER TAB CAN HOLD AN UPGRADE UP, AND EVERY OPEN WITH IT. A browser runs
 * an upgrade only once every other connection to the database has closed, and
 * it puts every open asked for after it — from this tab or any other tab of
 * the site, at any version — in line behind it. The build before version 2
 * opened the database at version 1, never closed it, and did not close when
 * asked. So one of its tabs left open on a phone kept a version-2 upgrade
 * waiting, and with it every report page's queue: the banner never showed,
 * and "save on this phone" never answered. Closing or reloading the tab that
 * asked does not take the request back; in Chromium it waits on until the old
 * tab goes (checked by hand, and by e2e/offline.spec.mjs). So:
 *
 *   - The database is opened as it is first. At this build's version or a
 *     later one, that is the connection. An older one is kept open while the
 *     page finds out whether it may ask for the upgrade: the queue is in every
 *     version, so the page has a working queue whatever the answer.
 *   - The service worker, which can see every window of the site, is asked
 *     how many are open (public/sw.js). Only this one: the page upgrades. More
 *     than one, or a worker too old to know the question — the one the build
 *     before installed, still active for a moment after a deploy, when an old
 *     tab is most likely — and the page goes on with the database as it is.
 *     Its queue works; the drafts' photographs and the list of sent reports,
 *     which need the new stores, are off until a page opens alone (drafts.ts
 *     and sent.ts do without them).
 *   - With no worker to ask (a browser or an in-app browser without them), the
 *     page upgrades, or it never would. If an old tab does hold that up, the
 *     callers are told so (OfflineDbBlocked) within a second or so instead of
 *     being left waiting, and the report form says to close the site's other
 *     tabs. The request stays in line, as it has to; when the old tab goes, its
 *     connection is the one every later call gets.
 *   - Every connection this build opens closes as soon as a newer version asks,
 *     and every open has a time limit past which it fails rather than waits.
 */
export const DB_NAME = "conservation-offline";
export const QUEUE_STORE = "pendingReports";
export const DRAFT_STORE = "drafts";
export const SENT_STORE = "sent";
export const DB_VERSION = 2;

/** The longest any one open may take before the caller is told it failed. */
export const OPEN_WAIT_MS = 3000;
/** How long the service worker has to say how many windows are open. */
const ASK_WAIT_MS = 1500;
/**
 * How long an upgrade the browser called blocked still has to come through.
 * A tab of this build lets go as soon as it is asked, but the browser may say
 * "blocked" a moment before it has.
 */
const BLOCKED_GRACE_MS = 1000;

/** The database is held at an older version by another tab of the site. */
export class OfflineDbBlocked extends Error {
  constructor() {
    super("the offline database is held open by another tab");
    this.name = "OfflineDbBlocked";
  }
}

/** Whether a failure is the database being held up by another tab. */
export const isBlocked = (e: unknown): boolean =>
  e instanceof Error && e.name === "OfflineDbBlocked";

/**
 * `promise`, or a rejection once `ms` have passed. A value that arrives after
 * that goes to `late`, so that a connection nobody is waiting for any more is
 * closed rather than left holding the database.
 */
function within<T>(promise: Promise<T>, ms: number, late?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let over = false;
    const timer = setTimeout(() => {
      over = true;
      reject(new OfflineDbBlocked());
    }, ms);
    promise.then(
      (value) => {
        if (over) late?.(value);
        else {
          clearTimeout(timer);
          resolve(value);
        }
      },
      (error) => {
        if (over) return;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const closeLate = (db: IDBPDatabase | null) => db?.close();

let dbPromise: Promise<IDBPDatabase> | null = null;
/** The connection `dbPromise` resolved to, so that letting it go forgets it. */
let current: IDBPDatabase | null = null;
/** An upgrade asked for and held up by another tab. See the top of this file. */
let held: Promise<IDBPDatabase> | null = null;

function forget(db: IDBPDatabase) {
  if (current !== db) return;
  current = null;
  dbPromise = null;
}

/** A newer version wants the database: close now, and open afresh next time. */
function letGo(db: IDBPDatabase) {
  db.close();
  forget(db);
}

function announce() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("conservation:queue-changed"));
}

/**
 * The database, upgraded to this build's version when that is safe, or as it
 * is when it is not (see the top of this file). Rejects with OfflineDbBlocked
 * rather than waiting on another tab.
 */
export function offlineDb(): Promise<IDBPDatabase> {
  if (held) return within(held, BLOCKED_GRACE_MS);
  if (!dbPromise) {
    const opening = connect();
    dbPromise = opening;
    opening.then(
      (db) => {
        if (dbPromise === opening) current = db;
      },
      // A failed open is not kept: the next call tries again.
      () => {
        if (dbPromise === opening) dbPromise = null;
      },
    );
  }
  return dbPromise;
}

async function connect(): Promise<IDBPDatabase> {
  const existing = await openAsItIs();
  if (existing) {
    if (existing.version >= DB_VERSION) return existing;
    if (!(await aloneOnSite())) return existing;
    existing.close();
  }
  return openUpgraded();
}

/** The database at whatever version it is, or null when there is none. */
async function openAsItIs(): Promise<IDBPDatabase | null> {
  const opening = openDB(DB_NAME, undefined, {
    upgrade(_database, oldVersion, _newVersion, transaction) {
      // There was no database. Abort, so that none is created at version 1:
      // the upgrade below creates it at this build's. The aborted
      // transaction's own promise is caught here, or every page a phone with
      // no queue opened logged an uncaught AbortError.
      if (oldVersion === 0) {
        transaction.done.catch(() => {});
        transaction.abort();
      }
    },
    blocking() {
      void opening.then(letGo);
    },
    terminated() {
      void opening.then(forget);
    },
  });
  try {
    return await within(opening, OPEN_WAIT_MS, closeLate);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return null;
    throw e;
  }
}

/**
 * Whether this is the only window of the site open, as far as anyone can
 * tell. True with no service worker to ask; false when the worker does not
 * answer, since the one that does not is the build before this one's.
 */
async function aloneOnSite(): Promise<boolean> {
  const workers = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (!workers) return true;
  let worker: ServiceWorker | null | undefined;
  try {
    worker = (await within(workers.getRegistration(), ASK_WAIT_MS))?.active;
  } catch {
    return true;
  }
  if (!worker) return true;
  const channel = new MessageChannel();
  const answer = new Promise<unknown>((resolve) => {
    channel.port1.onmessage = (e) => resolve((e.data as { windows?: unknown } | null)?.windows);
  });
  try {
    worker.postMessage({ type: "count-windows" }, [channel.port2]);
    return (await within(answer, ASK_WAIT_MS)) === 1;
  } catch {
    return false;
  } finally {
    channel.port1.close();
  }
}

/** The database at this build's version, created or upgraded as needed. */
function openUpgraded(): Promise<IDBPDatabase> {
  let giveUp = () => {};
  const asking = openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        const store = database.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains(DRAFT_STORE))
        database.createObjectStore(DRAFT_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(SENT_STORE))
        database.createObjectStore(SENT_STORE, { keyPath: "id" });
    },
    blocked() {
      setTimeout(() => giveUp(), BLOCKED_GRACE_MS);
    },
    blocking() {
      void asking.then(letGo);
    },
    terminated() {
      void asking.then(forget);
    },
  });
  return new Promise<IDBPDatabase>((resolve, reject) => {
    let settled = false;
    giveUp = () => {
      if (settled) return;
      settled = true;
      // Kept, not asked again: it is in line, and every open asked for after
      // it would only wait behind it.
      held = asking;
      reject(new OfflineDbBlocked());
    };
    const timer = setTimeout(() => giveUp(), OPEN_WAIT_MS);
    asking.then(
      (db) => {
        clearTimeout(timer);
        if (held === asking) {
          // The tab that held it up has gone. This is the connection now, and
          // the banner and the reminder are told to look again.
          held = null;
          current = db;
          dbPromise = Promise.resolve(db);
          announce();
        }
        if (!settled) {
          settled = true;
          resolve(db);
        }
      },
      (error) => {
        clearTimeout(timer);
        if (held === asking) held = null;
        if (!settled) {
          settled = true;
          reject(error);
        }
      },
    );
  });
}

/**
 * Read the database as it is, or answer `fallback` when there is none.
 *
 * Never creates it and never upgrades it. The queue reminder on every page and
 * the list on /me read through this, so that opening the home page does not
 * move the database to a version that a report page this phone keeps for
 * offline use — saved by the service worker from an earlier build — cannot
 * open. Only pages that open it through offlineDb() move it.
 *
 * The connection is closed once `read` is done. Held open, it would block the
 * upgrade a report page asks for a moment later in this same tab. And while
 * an upgrade is held up by another tab, this answers `fallback` at once, or
 * within OPEN_WAIT_MS when the upgrade waiting is another tab's: an open now
 * would only wait in line behind it.
 */
export async function readExisting<T>(
  read: (db: IDBPDatabase) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (held) return fallback;
  let db: IDBPDatabase | null = null;
  try {
    const opening = openDB(DB_NAME, undefined, {
      upgrade(_database, oldVersion, _newVersion, transaction) {
        // There was no database. Abort, so that none is created; see
        // openAsItIs.
        if (oldVersion === 0) {
          transaction.done.catch(() => {});
          transaction.abort();
        }
      },
      blocking() {
        void opening.then((d) => d.close());
      },
    });
    db = await within(opening, OPEN_WAIT_MS, closeLate);
    return await read(db);
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}
