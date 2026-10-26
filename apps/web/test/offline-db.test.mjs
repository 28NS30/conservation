/**
 * The offline database's upgrade never leaves a phone without its queue.
 *
 * lib/offline/db.ts, run in node over an in-memory IndexedDB that serves
 * opens in line, as browsers do (fixtures/fake-idb.mjs). The build before
 * version 2 opened the database and never let go, and a browser holds an
 * upgrade, and every open asked for after it in any tab, until every other
 * connection has closed: one old tab left open on a phone could keep every
 * report page's queue from ever answering. These hold db.ts to what it does
 * about that (see the top of that file), case by case. The same cases in a
 * real browser, with a real old tab, are in e2e/offline.spec.mjs.
 *
 *   node --test test/offline-db.test.mjs
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FAKE = pathToFileURL(join(import.meta.dirname, "fixtures", "fake-idb.mjs")).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "idb") return { url: FAKE, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const idb = await import(FAKE);
const NAME = "conservation-offline";

/** db.ts afresh, as a page that has just opened: its connection is per page. */
let pages = 0;
const freshPage = () => import(`../lib/offline/db.ts?page=${++pages}`);

/** A service worker that answers how many windows are open, or never does. */
function worker(windows) {
  const active = {
    postMessage(_message, [port]) {
      if (windows !== undefined) port.postMessage({ windows });
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { serviceWorker: { getRegistration: async () => ({ active }) } },
    configurable: true,
  });
}
const noWorker = () =>
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });

const waiting = { id: "a1", createdAt: 1, status: "queued", payload: {}, photos: [], uploadedPaths: [], attempts: 0 };
/** What the build before version 2 left: the queue, with a report in it. */
const versionOne = () => idb.seedDatabase(NAME, 1, { pendingReports: "id" }, { pendingReports: [waiting] });

beforeEach(() => {
  idb.resetDatabases();
  noWorker();
});

describe("upgrading", () => {
  test("a version-1 database comes up to 2 with its waiting report, when this is the only window", async () => {
    versionOne();
    worker(1);
    const { offlineDb } = await freshPage();
    const db = await offlineDb();
    assert.equal(db.version, 2);
    for (const s of ["pendingReports", "drafts", "sent"]) assert.ok(db.objectStoreNames.contains(s), s);
    assert.deepEqual(await db.get("pendingReports", "a1"), waiting);
  });

  test("an empty version-1 database gets a queue, rather than every queue call throwing", async () => {
    idb.seedDatabase(NAME, 1, {});
    const { offlineDb } = await freshPage();
    const db = await offlineDb();
    assert.ok(db.objectStoreNames.contains("pendingReports"));
    await db.put("pendingReports", waiting);
    assert.equal(await db.count("pendingReports"), 1);
  });

  test("no database: created at this build's version, never at 1", async () => {
    const { offlineDb, DB_VERSION } = await freshPage();
    assert.equal((await offlineDb()).version, DB_VERSION);
  });
});

describe("not upgrading while another tab may hold the database", () => {
  test("another window open: the queue works at version 1, and no upgrade is asked for", async () => {
    versionOne();
    worker(2);
    const { offlineDb } = await freshPage();
    const db = await offlineDb();
    assert.equal(db.version, 1, "upgraded with another window open");
    assert.deepEqual(await db.get("pendingReports", "a1"), waiting);
    await db.put("pendingReports", { ...waiting, id: "a2" });
    assert.equal(await db.count("pendingReports"), 2);
    // An upgrade asked for and held would wait in line, and this open behind it.
    assert.equal((await idb.openDB(NAME)).version, 1);
  });

  test("a worker too old to know the question: left as it is too, since its build's tabs may be open", async () => {
    versionOne();
    worker(undefined);
    const { offlineDb } = await freshPage();
    const started = Date.now();
    const db = await offlineDb();
    assert.equal(db.version, 1);
    assert.ok(Date.now() - started < 2500, "waited too long for an answer that was never coming");
  });

  test("drafts and the sent list do without their stores, quietly", async () => {
    versionOne();
    worker(2);
    // drafts.ts brings its own db.ts, opened for the first time here.
    const drafts = await import("../lib/offline/drafts.ts");
    await drafts.saveDraftPhotos("n1", [{ id: "p", blob: { size: 1 }, width: 1, height: 1, gps: null, takenAt: null }]);
    assert.deepEqual(await drafts.loadDraftPhotos("n1"), []);
    const sent = await import("../lib/offline/sent.ts");
    await sent.recordSent({ id: "r1", sentAt: 1, page: "roadkill", category: "roadkill", label: null });
    assert.deepEqual(await sent.listSent(), []);
  });
});

describe("an upgrade held up by an old tab", () => {
  test("is told, not waited on; reads answer at once; and when the tab goes, the upgrade is the connection", async () => {
    versionOne();
    noWorker();
    const release = idb.holdUpgrades();
    const { offlineDb, readExisting, isBlocked } = await freshPage();

    let started = Date.now();
    await assert.rejects(offlineDb(), (e) => isBlocked(e));
    assert.ok(Date.now() - started < 2500, `the first caller waited ${Date.now() - started} ms`);

    started = Date.now();
    await assert.rejects(offlineDb(), (e) => isBlocked(e));
    assert.ok(Date.now() - started < 1500, "a later caller waited as long as the first");

    started = Date.now();
    assert.equal(await readExisting(async () => "read", "fallback"), "fallback");
    assert.ok(Date.now() - started < 100, "a read waited in line behind the upgrade");

    release();
    await new Promise((r) => setTimeout(r, 10));
    const db = await offlineDb();
    assert.equal(db.version, 2);
    assert.deepEqual(await db.get("pendingReports", "a1"), waiting);
  });

  test("another tab's held upgrade: every open here fails within its time limit instead of hanging", async () => {
    versionOne();
    const release = idb.holdUpgrades();
    // Some other tab asked for an upgrade, and an old one is holding it up.
    const elsewhere = idb.openDB(NAME, 3, {});
    const { offlineDb, readExisting, isBlocked, OPEN_WAIT_MS } = await freshPage();

    let started = Date.now();
    await assert.rejects(offlineDb(), (e) => isBlocked(e));
    assert.ok(Date.now() - started < OPEN_WAIT_MS + 500);

    started = Date.now();
    assert.equal(await readExisting(async () => "read", "fallback"), "fallback");
    assert.ok(Date.now() - started < OPEN_WAIT_MS + 500);

    release();
    await elsewhere;
  });
});
