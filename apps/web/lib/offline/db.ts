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
 * Each step of the upgrade is guarded by the version it came in with, so
 * opening an existing database never creates a store twice — that throws
 * ConstraintError, and listQueued() rejecting with nothing to catch it is a
 * silent, total loss of the queue on screen. The step for version 1 creates
 * the queue exactly as version 1 did, so a phone that has only ever had this
 * build has the same store a phone that upgraded keeps, rows and all
 * (e2e/offline.spec.mjs opens a version-1 database with a report in it).
 */
export const DB_NAME = "conservation-offline";
export const QUEUE_STORE = "pendingReports";
export const DRAFT_STORE = "drafts";
export const SENT_STORE = "sent";
export const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

/** The database at this build's version, upgraded if it is older. */
export function offlineDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    const opening = openDB(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          const store = database.createObjectStore(QUEUE_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
        if (oldVersion < 2) {
          database.createObjectStore(DRAFT_STORE, { keyPath: "id" });
          database.createObjectStore(SENT_STORE, { keyPath: "id" });
        }
      },
      // A tab running a newer build wants to upgrade. Holding the connection
      // open would keep that tab waiting, its queue unreadable, until this
      // one closed; letting go costs this tab a reopen on its next read.
      blocking() {
        void opening.then((d) => d.close());
        if (dbPromise === opening) dbPromise = null;
      },
      terminated() {
        if (dbPromise === opening) dbPromise = null;
      },
    });
    // A failed open is not cached: the next read tries again.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
    dbPromise = opening;
  }
  return dbPromise;
}

/**
 * Read the database as it is, or answer `fallback` when there is none.
 *
 * Never creates it and never upgrades it. The queue reminder on every page and
 * the list on /me read through this, so that opening the home page does not
 * move the database to a version that a report page this phone keeps for
 * offline use — saved by the service worker from an earlier build — cannot
 * open. Only the report pages, whose own copies are refreshed whenever they
 * are opened with a signal, move it.
 *
 * The connection is closed once `read` is done. Held open, it would block the
 * upgrade a report page asks for a moment later in this same tab.
 */
export async function readExisting<T>(
  read: (db: IDBPDatabase) => Promise<T>,
  fallback: T,
): Promise<T> {
  let db: IDBPDatabase | null = null;
  try {
    db = await openDB(DB_NAME, undefined, {
      upgrade(_database, oldVersion, _newVersion, transaction) {
        // There was no database. Abort, so that none is created: an empty
        // version-1 database would skip the step that creates the queue.
        // The aborted transaction's own promise is caught here, or every
        // page a phone with no queue opened logged an uncaught AbortError.
        if (oldVersion === 0) {
          transaction.done.catch(() => {});
          transaction.abort();
        }
      },
      blocking() {
        db?.close();
      },
    });
    return await read(db);
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}
