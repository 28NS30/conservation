/**
 * Offline submission, end to end in a real browser.
 *
 *   node e2e/offline.spec.mjs
 *
 * Playwright can genuinely cut the network, so this proves the behaviour rather
 * than inspecting it: submit with no connection, restore it, and assert the
 * report lands exactly once.
 */
import { chromium } from "playwright";
import postgres from "postgres";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
if (existsSync(join(ROOT, ".env")) && !process.env.DATABASE_URL) {
  process.loadEnvFile(join(ROOT, ".env"));
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, onnotice: () => {} });

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
// Must be a real UUID: reportSubmissionSchema requires one, and the API rightly
// rejects anything else with a 400 (which sendOne then treats as permanent).
const NONCE = crypto.randomUUID();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 500, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/report`, { waitUntil: "load" });

// Register the worker from the test rather than waiting for the app to do it.
//
// components/ServiceWorker.tsx deliberately skips registration in development
// unless NEXT_PUBLIC_SW_IN_DEV is set, so that a stale cache never confuses
// someone editing pages. Waiting on navigator.serviceWorker.ready against a dev
// server therefore just times out, and the two checks below silently degrade
// into failures that look like product bugs rather than a missing precondition.
// public/sw.js is a plain static asset, so registering it here exercises exactly
// the worker that production would install.
const swReady = await page
  .evaluate(async () => {
    if (!("serviceWorker" in navigator)) return "unsupported";
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch (e) {
      return `register failed: ${e.message}`;
    }
    return Promise.race([
      navigator.serviceWorker.ready.then(() => "ready"),
      new Promise((r) => setTimeout(() => r("timeout"), 10000)),
    ]);
  })
  .catch(() => "error");
await page.reload({ waitUntil: "load" });
const controlled = await page.evaluate(() => !!navigator.serviceWorker?.controller);
console.log(`  info service worker: ${swReady}, controlling page: ${controlled}`);

// Drive the queue directly: the form's photo picker needs a real file input and
// the geolocation permission dance, none of which is what this test is about.
const enqueueInPage = async (id) =>
  page.evaluate(async ({ id }) => {
    const { enqueue } = await import("/_next/static/chunks/__nonexistent.js").catch(() => ({}));
    // Fall back to talking to IndexedDB directly with the same schema the app uses.
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("conservation-offline", 1);
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore("pendingReports", { keyPath: "id" });
        s.createIndex("createdAt", "createdAt");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const record = {
      id,
      createdAt: Date.now(),
      payload: {
        category: "pollution", // non-classifiable: publishes immediately, no photo needed
        lng: 120.95,
        lat: 23.75,
        observedAt: new Date().toISOString(),
        notes: "offline e2e",
      },
      photos: [],
      uploadedPaths: [],
      attempts: 0,
      status: "queued",
    };
    await new Promise((res, rej) => {
      const tx = db.transaction("pendingReports", "readwrite");
      tx.objectStore("pendingReports").put(record);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    return true;
  }, { id });

const queueCount = () =>
  page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("conservation-offline", 1);
      r.onsuccess = () => res(r.result);
    });
    return new Promise((res) => {
      const tx = db.transaction("pendingReports", "readonly");
      const req = tx.objectStore("pendingReports").count();
      req.onsuccess = () => res(req.result);
    });
  });

const dbCount = async (nonce) => {
  const [row] = await sql`select count(*)::int as n from reports where client_nonce = ${nonce}`;
  return row.n;
};

try {
  // --- queue while offline -------------------------------------------------
  await ctx.setOffline(true);
  await enqueueInPage(NONCE);
  check("report is queued in IndexedDB", (await queueCount()) >= 1);
  check("nothing reached the database yet", (await dbCount(NONCE)) === 0);

  // --- the page itself must open with no connection ------------------------
  // This is the point of the service worker: a queue is useless if /report will
  // not load. Requires a production build (the SW is disabled in dev).
  let openedOffline = true;
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  } catch {
    openedOffline = false;
  }
  check("/report opens while offline (service worker)", openedOffline);
  if (!openedOffline) {
    // Restore a usable page so the remaining assertions can still run.
    await ctx.setOffline(false);
    await page.goto(`${BASE}/report`, { waitUntil: "load" });
    await ctx.setOffline(true);
  }
  check("queue survives a reload", (await queueCount()) >= 1);

  // --- flush once back online ---------------------------------------------
  await ctx.setOffline(false);
  await page.goto(`${BASE}/report`, { waitUntil: "load" });
  await page.waitForTimeout(4000);

  const landed = await dbCount(NONCE);
  check("report reaches the database once online", landed === 1, `rows=${landed}`);
  check("queue is drained", (await queueCount()) === 0);

  // --- idempotency ---------------------------------------------------------
  // Re-queue the SAME nonce and flush again; the unique index plus the API's
  // duplicate handling must keep this at exactly one row.
  await enqueueInPage(NONCE);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(3500);
  const after = await dbCount(NONCE);
  check("re-flushing the same nonce does not duplicate", after === 1, `rows=${after}`);
} finally {
  await sql`delete from reports where client_nonce = ${NONCE}`;
  await sql.end();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
