/**
 * Offline submission, end to end in a real browser.
 *
 *   node e2e/offline.spec.mjs
 *
 * Playwright can genuinely cut the network, so this proves the behaviour rather
 * than inspecting it: submit with no connection, restore it, and assert the
 * report lands exactly once.
 *
 * Since the report form became three pages it also proves what that split
 * could have broken, and what the split was the moment to fix:
 *
 *   - every report page, and the chooser, opens with no signal once any ONE of
 *     them has been visited (the worker only caches what it has seen, and the
 *     pages warm each other; components/report/WarmReportPages.tsx);
 *   - the waiting-reports banner is on all of them, so a saved report is sent
 *     from whichever report page is open next;
 *   - "Save on this phone" works on a page opened with no signal — the button
 *     used to wait for a Turnstile token that cannot be had offline;
 *   - a send that hangs offers to save instead, and saving then abandons the
 *     send without the report landing twice;
 *   - the words say "open the report page", not "open this site".
 *
 * And what the form and the queue do so that a report is never stranded:
 *
 *   - a version-1 database is upgraded with its waiting report intact
 *     (lib/offline/db.ts), and a reminder of it is on every page but the
 *     report pages, without being in what /map loads first;
 *   - a report the queue gave up on can be tried again, and a discard can be
 *     undone for a few seconds — still after a reload, never sent meanwhile,
 *     and deleted when they are up even if the tab was closed — and the
 *     reminder stops saying a report is waiting once none is;
 *   - a tab of the build before version 2, holding the database open and
 *     deaf to requests to let go, never leaves a new tab without its queue:
 *     with a service worker to ask, the new tab keeps the database at version
 *     1 and saving on the phone works; with none, it says to close the other
 *     tab instead of hanging, and recovers by itself once that tab is closed;
 *   - a report half filled in, photo and all, comes back after a reload and
 *     after the language switch, both of which ask first, as a link does.
 *
 * Turnstile. Local development and CI build without a site key, so there is
 * no challenge to wait for, and the no-token backup cannot appear. The spec
 * notices whether this build asks Cloudflare for its script and runs that
 * check only when it does; the decision itself is walked case by case, with
 * and without a token, in test/send-state.test.mjs. To run it here, build with
 * Cloudflare's published always-passes test site key in
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY (and no secret key, so the server does not
 * ask).
 */
import { chromium } from "playwright";
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
if (existsSync(join(ROOT, ".env")) && !process.env.DATABASE_URL) {
  process.loadEnvFile(join(ROOT, ".env"));
}
const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  onnotice: () => {},
});

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const ZH = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "messages", "zh-TW.json"), "utf8"),
);
const EN = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "messages", "en.json"), "utf8"),
);
// Must be a real UUID: reportSubmissionSchema requires one, and the API rightly
// rejects anything else with a 400 (which sendOne then treats as permanent).
const NONCE = crypto.randomUUID();
/** Every nonce this run put in the database, for the cleanup at the end. */
const nonces = [NONCE];
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`,
  );
};
const info = (line) => console.log(`  info ${line}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 500, height: 900 },
  locale: "zh-TW",
});
// Somewhere in Nantou. The form's "use my location" is the fastest way to set
// a place without driving the map, and it answers with no signal.
await ctx.grantPermissions(["geolocation"], { origin: BASE });
await ctx.setGeolocation({ latitude: 23.75, longitude: 120.95, accuracy: 30 });

let askedCloudflare = false;
ctx.on("request", (r) => {
  if (r.url().includes("challenges.cloudflare.com")) askedCloudflare = true;
});

const page = await ctx.newPage();
await page.goto(`${BASE}/report/roadkill`, { waitUntil: "load" });

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
// Reloaded so the page is controlled, and so WarmReportPages — which asks the
// worker once it is ready — runs against a worker that is.
await page.reload({ waitUntil: "load" });
const controlled = await page.evaluate(
  () => !!navigator.serviceWorker?.controller,
);
info(`service worker: ${swReady}, controlling page: ${controlled}`);

/** Whether the worker's cache holds a page, by path. */
const cached = (path) =>
  page.evaluate(async (p) => {
    const keys = await caches.keys();
    for (const k of keys) {
      const c = await caches.open(k);
      if (await c.match(new URL(p, location.origin).href, { ignoreVary: true }))
        return true;
    }
    return false;
  }, path);

// The warm-up runs in the worker after the page asks; give it the time a
// handful of page renders take on a cold server.
for (let i = 0; i < 30; i++) {
  const all = await Promise.all(
    ["/report", "/report/invasive", "/report/wildlife"].map(cached),
  );
  if (all.every(Boolean)) break;
  await page.waitForTimeout(1000);
}

// Drive the queue directly: the form's photo picker needs a real file input and
// the geolocation permission dance, none of which is what this test is about.
const enqueueInPage = async (id) =>
  page.evaluate(
    async ({ id }) => {
      // Talk to IndexedDB directly with the same schema the app uses. At
      // whatever version the app has left it: version 1 is the queue alone,
      // and lib/offline/db.ts upgrades it to 2 when the page next opens it.
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("conservation-offline");
        r.onupgradeneeded = () => {
          const s = r.result.createObjectStore("pendingReports", {
            keyPath: "id",
          });
          s.createIndex("createdAt", "createdAt");
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const record = {
        id,
        createdAt: Date.now(),
        payload: {
          category: "roadkill", // no photo, so requiresClassification() is false
          page: "roadkill",
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
      // Held open, this connection would block the app's own upgrade.
      db.close();
      return true;
    },
    { id },
  );

/**
 * Rows in the store, by status.
 *
 * A sent report is no longer deleted: it stays as an `uploaded` receipt with
 * its photographs dropped, so the banner can show that it landed and link to
 * it. So "drained" means nothing is still waiting, not that the store is empty
 * — and counting rows alone would now pass whether the report had been sent or
 * was still sitting there.
 *
 * Opened at whatever version is there. The database is at 2 since the drafts
 * and the sent list got stores of their own (lib/offline/db.ts); adding fields
 * to a stored object needs no upgrade, only a new store or index does.
 */
const rows = (p = page) =>
  p.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("conservation-offline");
      r.onsuccess = () => res(r.result);
    });
    const all = await new Promise((res) => {
      const tx = db.transaction("pendingReports", "readonly");
      const req = tx.objectStore("pendingReports").getAll();
      req.onsuccess = () => res(req.result);
    });
    db.close();
    return all;
  });
const counts = async () => {
  const all = await rows();
  return {
    total: all.length,
    pending: all.filter((r) => r.status !== "uploaded").length,
    receipts: all.filter((r) => r.status === "uploaded").length,
    withReportId: all.filter((r) => r.status === "uploaded" && r.reportId).length,
  };
};

const queueCount = async () => (await counts()).pending;

/**
 * Forget how many reports this address has sent lately.
 *
 * The burst limit is six in two minutes per address, this spec sends more
 * than that, and on a shared database every other suite sending from
 * localhost counts against the same address. Rate limiting has its own
 * tests; here it would only make the checks below depend on who else ran
 * what, when — the same reason test/report-species.test.mjs clears it.
 */
const clearSubmitLimits = () => sql`delete from rate_limits where key like 'submit-%'`;

const dbCount = async (nonce) => {
  const [row] =
    await sql`select count(*)::int as n from reports where client_nonce = ${nonce}`;
  return row.n;
};

/**
 * Tell a page opened with no network that it has none.
 *
 * Playwright's offline emulation cuts the network for every document, but a
 * document it serves from the service worker's cache after a navigation
 * reports `navigator.onLine === true` until the setting changes again — a
 * phone in airplane mode does not. Setting it off and on again re-applies it
 * to the current document and fires the `offline` event, which is what a
 * phone that lost its signal does anyway.
 */
const reassertOffline = async (context = ctx, p = page) => {
  if (!(await p.evaluate(() => navigator.onLine))) return;
  await context.setOffline(false);
  await context.setOffline(true);
};

let offline = false;
/** Open a page and say whether it rendered, without throwing. */
const open = async (path) => {
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    if (offline) await reassertOffline();
    return true;
  } catch {
    return false;
  }
};

/** Put a place on the form the way a reporter at the roadside would. */
const tapUseMyLocation = async (locale = ZH) => {
  // Set again each time: toggling the emulated network (reassertOffline) can
  // drop Playwright's geolocation override for the page, and the fix then
  // never answers. A phone's GPS does not care whether it has signal.
  await ctx.setGeolocation({ latitude: 23.75, longitude: 120.95, accuracy: 30 });
  // Pages are opened at `domcontentloaded`, and a tap that lands before the
  // page has hydrated does nothing — as it would for a person, who would tap
  // again. So does this.
  for (let i = 0; i < 4; i++) {
    // Short, because once a tap has taken the button reads "locating…".
    await page
      .getByRole("button", { name: locale.report.useMyLocation })
      .click({ timeout: 2000 })
      .catch(() => {});
    const set = await page
      .getByText(locale.report.tapToAdjust)
      .waitFor({ timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (set) return;
  }
  throw new Error("the location never set");
};

/** The same on any page of any context. Says whether the place was set. */
const placeOn = async (p, context) => {
  for (let i = 0; i < 4; i++) {
    await context.setGeolocation({ latitude: 23.75, longitude: 120.95, accuracy: 30 });
    await p.getByRole("button", { name: ZH.report.useMyLocation }).click({ timeout: 2000 }).catch(() => {});
    if (await p.getByText(ZH.report.tapToAdjust).waitFor({ timeout: 4000 }).then(() => true).catch(() => false))
      return true;
  }
  return false;
};

/** A waiting report, written straight into the queue at whatever version it is. */
const putQueued = (p, id, notes = "offline e2e") =>
  p.evaluate(
    async ({ id, notes }) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("conservation-offline");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction("pendingReports", "readwrite");
        tx.objectStore("pendingReports").put({
          id,
          createdAt: Date.now(),
          payload: {
            category: "roadkill",
            page: "roadkill",
            lng: 120.95,
            lat: 23.75,
            observedAt: new Date().toISOString(),
            notes,
          },
          photos: [],
          uploadedPaths: [],
          attempts: 0,
          status: "queued",
        });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    { id, notes },
  );

/** One row of the queue, or null. */
const rowOf = (p, id) =>
  p.evaluate(async (id) => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("conservation-offline");
      r.onsuccess = () => res(r.result);
    });
    const row = await new Promise((res) => {
      const req = db.transaction("pendingReports").objectStore("pendingReports").get(id);
      req.onsuccess = () => res(req.result);
    });
    db.close();
    return row ?? null;
  }, id);

/** The database's version and its queue, opened as it is. */
const dbState = (p) =>
  p.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("conservation-offline");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows = await new Promise((res) => {
      const req = db.transaction("pendingReports").objectStore("pendingReports").getAll();
      req.onsuccess = () => res(req.result);
    });
    const out = { version: db.version, stores: [...db.objectStoreNames], rows };
    db.close();
    return out;
  });

/**
 * Be a tab of the build before version 2: open the database at version 1,
 * with a report waiting in it, and keep the connection — never closing it,
 * and not listening for a newer version asking it to.
 */
const beOldTab = (p, id) =>
  p.evaluate(async (id) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("conservation-offline", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("pendingReports", { keyPath: "id" }).createIndex("createdAt", "createdAt");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction("pendingReports", "readwrite");
      tx.objectStore("pendingReports").put({
        id,
        createdAt: Date.now(),
        payload: {
          category: "roadkill",
          page: "roadkill",
          lng: 120.95,
          lat: 23.75,
          observedAt: new Date().toISOString(),
          notes: "old tab e2e",
        },
        photos: [],
        uploadedPaths: [],
        attempts: 0,
        status: "queued",
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    window.oldTab = db;
  }, id);

try {
  // --- queue while offline -------------------------------------------------
  await ctx.setOffline(true);
  offline = true;
  await enqueueInPage(NONCE);
  check("report is queued in IndexedDB", (await queueCount()) >= 1);
  check("nothing reached the database yet", (await dbCount(NONCE)) === 0);

  // --- the page itself must open with no connection ------------------------
  // This is the point of the service worker: a queue is useless if the report
  // page will not load. Requires a production build (the SW is off in dev).
  let openedOffline = true;
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  } catch {
    openedOffline = false;
  }
  check("the report page it was on opens while offline (service worker)", openedOffline);
  if (!openedOffline) {
    // Restore a usable page so the remaining assertions can still run.
    await ctx.setOffline(false);
    await page.goto(`${BASE}/report/roadkill`, { waitUntil: "load" });
    await ctx.setOffline(true);
  }
  check("queue survives a reload", (await queueCount()) >= 1);

  // --- every report page, having visited only one --------------------------
  // Only /report/roadkill was ever navigated to. The other three must come out
  // of the cache the warm-up filled, and must come up working: the button
  // reads "Save on this phone" only once the page's script has run and seen
  // that there is no network, so a page served as bare HTML without its
  // chunks fails here rather than passing on a status code.
  for (const path of ["/report", "/report/invasive", "/report/wildlife", "/report/roadkill"]) {
    const opened = await open(path);
    let banner = false;
    let working = path === "/report";
    if (opened) {
      // 20 s, not 8: the banner shows once the page's script has read the
      // queue from IndexedDB, and the first page in this loop starts with its
      // chunks cold in the worker's cache. On CI's runners that has taken
      // longer than 8 s often enough to fail unrelated pull requests (#141,
      // #142) while every later page passed.
      banner = await page
        .locator("#queue-waiting")
        .waitFor({ timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      if (path !== "/report")
        working = await page
          .getByRole("button", { name: ZH.report.saveOnPhone, exact: true })
          .waitFor({ timeout: 8000 })
          .then(() => true)
          .catch(() => false);
    }
    check(`${path} opens offline, having only visited another report page`, opened && working);
    check(`${path} shows the reports waiting to be sent`, banner);
  }

  // --- the words name the report page, not the site ------------------------
  const waitingText = await page
    .locator('section[aria-labelledby="queue-waiting"]')
    .innerText()
    .catch(() => "");
  check(
    "offline, the banner says what will send it: the report page",
    waitingText.includes("通報頁面") && !waitingText.includes("本網站"),
    JSON.stringify(waitingText.slice(0, 120)),
  );

  // --- save a report from a page opened with no signal ---------------------
  // What production could not do: the button waited for a Turnstile token,
  // and Turnstile's script cannot load offline.
  await open("/report/wildlife");
  await page.getByRole("button", { name: ZH.report.saveOnPhone, exact: true }).waitFor({ timeout: 8000 });
  await tapUseMyLocation();
  const before = new Set((await rows()).map((r) => r.id));
  await page.getByRole("button", { name: ZH.report.saveOnPhone, exact: true }).click();
  const savedCard = await page
    .getByRole("heading", { name: ZH.offline.queuedTitle })
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check("offline, 'Save on this phone' saves the report", savedCard);
  const saved = (await rows()).find((r) => !before.has(r.id));
  if (saved) nonces.push(saved.id);
  check(
    "it is saved as the page it came from, with no token in it",
    saved?.payload.page === "wildlife" &&
      saved?.payload.category === "sighting" &&
      !("turnstileToken" in (saved?.payload ?? {})),
    JSON.stringify(saved?.payload ?? null),
  );
  const cardText = savedCard
    ? await page.getByRole("heading", { name: ZH.offline.queuedTitle }).locator("..").innerText()
    : "";
  check(
    "the saved card says to open the report page, not the site",
    cardText.includes("通報頁面") && !cardText.includes("本網站"),
  );

  // --- flush once back online ---------------------------------------------
  await ctx.setOffline(false);
  offline = false;
  await clearSubmitLimits();
  await page.goto(`${BASE}/report`, { waitUntil: "load" });
  // Two reports are waiting. Under a challenge each needs a token of its own,
  // and the widget solves again between them, so wait for the queue to drain
  // rather than for a fixed time.
  for (let i = 0; i < 30 && (await queueCount()) > 0; i++)
    await page.waitForTimeout(1000);
  await page.waitForTimeout(1000);

  const landed = await dbCount(NONCE);
  check(
    "report reaches the database once online, from the chooser",
    landed === 1,
    `rows=${landed}`,
  );
  if (saved) {
    const [row] = await sql`select category from reports where client_nonce = ${saved.id}`;
    check("the report saved offline lands as a sighting", row?.category === "sighting", JSON.stringify(row));
  }
  check("nothing is left waiting", (await queueCount()) === 0);

  // The state the team asked for and the queue did not have: a report that
  // landed says so, and can be opened, instead of silently disappearing.
  const afterFlush = await counts();
  check(
    "a sent report leaves a receipt that links to it",
    afterFlush.receipts >= 1 && afterFlush.withReportId === afterFlush.receipts,
    JSON.stringify(afterFlush),
  );

  // --- idempotency ---------------------------------------------------------
  // Re-queue the SAME nonce and flush again; the unique index plus the API's
  // duplicate handling must keep this at exactly one row.
  await clearSubmitLimits();
  await enqueueInPage(NONCE);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(3500);
  const after = await dbCount(NONCE);
  check(
    "re-flushing the same nonce does not duplicate",
    after === 1,
    `rows=${after}`,
  );

  // --- a send that hangs ---------------------------------------------------
  // One bar of signal: the request goes out and nothing comes back. The first
  // POST is held forever; anything after it — the queue's own send — goes
  // through, so the report must land exactly once.
  //
  // Only the form's own send is held, picked out by its nonce: under a
  // challenge the queue may still be sending a report of its own when the page
  // opens, and holding that one instead would test nothing.
  await clearSubmitLimits();
  const beforeSlow = new Set((await rows()).map((r) => r.id));
  let held = false;
  await page.route("**/api/reports", (route) => {
    const nonce = route.request().postDataJSON()?.clientNonce;
    if (!held && !beforeSlow.has(nonce)) {
      held = true;
      return; // never answered
    }
    return route.continue();
  });
  await open("/report/wildlife");
  await tapUseMyLocation();
  await page.getByRole("button", { name: ZH.report.submit, exact: true }).click();
  const backup = page.getByRole("button", { name: ZH.report.backupSlow });
  const early = await backup.isVisible();
  const appeared = await backup
    .waitFor({ timeout: 16000 })
    .then(() => true)
    .catch(() => false);
  check("a send that hangs offers to save on the phone instead", !early && appeared);
  if (appeared) {
    await backup.click();
    const queued = await page
      .getByRole("heading", { name: ZH.offline.queuedTitle })
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    check("and saving there abandons the send and keeps the report", queued);
    const slow = (await rows()).find((r) => !beforeSlow.has(r.id));
    if (slow) nonces.push(slow.id);
    // The banner sends it on its own, through the route that now answers —
    // after solving a challenge of its own, where the build has one.
    for (let i = 0; i < 25 && slow && (await dbCount(slow.id)) === 0; i++)
      await page.waitForTimeout(1000);
    await page.waitForTimeout(1000);
    const n = slow ? await dbCount(slow.id) : -1;
    check("the report lands exactly once", n === 1, `rows=${n}`);
  }
  await page.unroute("**/api/reports");

  // --- a challenge that never solves ---------------------------------------
  if (askedCloudflare) {
    await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
    await open("/report/invasive");
    await tapUseMyLocation();
    const noToken = page.getByRole("button", { name: ZH.report.backupNoToken });
    const shown = await noToken
      .waitFor({ timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    check("a challenge that never solves offers to save on the phone", shown);
    await page.unroute("**/challenges.cloudflare.com/**");
  } else {
    info("skipped the no-token backup: this build has no Turnstile site key (see the header)");
  }

  // --- the other language --------------------------------------------------
  // The warm-up is per language: an English reader's pages are /en/report/…
  const en = await browser.newContext({ viewport: { width: 500, height: 900 }, locale: "en-US" });
  const enPage = await en.newPage();
  await enPage.goto(`${BASE}/en/report/invasive`, { waitUntil: "load" });
  await enPage.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await enPage.reload({ waitUntil: "load" });
  for (let i = 0; i < 30; i++) {
    const done = await enPage.evaluate(async () => {
      const c = await caches.open("report-v4");
      return Boolean(await c.match(new URL("/en/report/roadkill", location.origin).href, { ignoreVary: true }));
    });
    if (done) break;
    await enPage.waitForTimeout(1000);
  }
  await en.setOffline(true);
  let enOpened = true;
  try {
    await enPage.goto(`${BASE}/en/report/roadkill`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await reassertOffline(en, enPage);
    await enPage
      .getByRole("button", { name: EN.report.saveOnPhone, exact: true })
      .waitFor({ timeout: 8000 });
  } catch {
    enOpened = false;
  }
  check("/en/report/roadkill opens offline, having only visited /en/report/invasive", enOpened);
  await en.close();

  // --- what the worker keeps -------------------------------------------------
  // Only public pages. v2 kept every page it was shown, so a moderator's /admin
  // (exact coordinates) and a person's /me (their email) were served again
  // after sign-out to the next person on the device (security audit, 29
  // September 2026). The policy is by path, so an anonymous visit shows it.
  const keep = await browser.newContext({ viewport: { width: 500, height: 900 }, locale: "en-US" });
  const keepPage = await keep.newPage();
  await keepPage.goto(`${BASE}/en/stats`, { waitUntil: "load" });
  await keepPage.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await keepPage.reload({ waitUntil: "load" });
  const [anyRecord] = await sql`select id from reports_public limit 1`;
  const privatePaths = ["/en/me", "/en/login", "/en/admin", `/en/reports/${anyRecord.id}`];
  for (const path of [...privatePaths, "/en/stats"])
    await keepPage.goto(`${BASE}${path}`, { waitUntil: "load" }).catch(() => {});
  await keepPage.waitForTimeout(1500);
  const kept = await keepPage.evaluate(async (paths) => {
    const c = await caches.open("shell-v4");
    const out = {};
    for (const p of paths)
      out[p] = Boolean(await c.match(new URL(p, location.origin).href, { ignoreVary: true, ignoreSearch: true }));
    return out;
  }, [...privatePaths, "/en/stats"]);
  check("the worker keeps no personal page", privatePaths.every((p) => !kept[p]), JSON.stringify(kept));
  check("and still keeps a public one", kept["/en/stats"] === true);
  await keep.close();

  // --- an older database, upgraded with its queue in it ---------------------
  // Version 2 added the drafts and the sent list (lib/offline/db.ts). A phone
  // that has a report waiting in a version-1 database must keep it through
  // the upgrade, and then be reminded of it on every page.
  const up = await browser.newContext({ viewport: { width: 500, height: 900 }, locale: "zh-TW" });
  const upPage = await up.newPage();
  // A file of the site with none of its scripts, so nothing opens the
  // database before the old one is made.
  await upPage.goto(`${BASE}/sw.js`, { waitUntil: "load" });
  const OLD = crypto.randomUUID();
  nonces.push(OLD);
  await upPage.evaluate(async (id) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("conservation-offline", 1);
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore("pendingReports", { keyPath: "id" });
        s.createIndex("createdAt", "createdAt");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction("pendingReports", "readwrite");
      tx.objectStore("pendingReports").put({
        id,
        createdAt: Date.now(),
        payload: {
          category: "roadkill",
          page: "roadkill",
          lng: 120.95,
          lat: 23.75,
          observedAt: new Date().toISOString(),
          notes: "upgrade e2e",
        },
        photos: [],
        uploadedPaths: [],
        attempts: 0,
        status: "queued",
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, OLD);
  // Its send never reaches the server, so it is still on the phone to be found.
  await upPage.route("**/api/reports", (route) => route.abort());
  await upPage.goto(`${BASE}/report/roadkill`, { waitUntil: "load" });
  const upBanner = await upPage
    .locator("#queue-waiting")
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const upgraded = await upPage.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("conservation-offline");
      r.onsuccess = () => res(r.result);
    });
    const rows = await new Promise((res) => {
      const req = db.transaction("pendingReports").objectStore("pendingReports").getAll();
      req.onsuccess = () => res(req.result);
    });
    const out = { version: db.version, stores: [...db.objectStoreNames], rows };
    db.close();
    return out;
  });
  check(
    "a version-1 database is upgraded to 2, with the drafts and sent stores",
    upgraded.version === 2 && ["drafts", "pendingReports", "sent"].every((s) => upgraded.stores.includes(s)),
    JSON.stringify({ version: upgraded.version, stores: upgraded.stores }),
  );
  check(
    "and the report waiting in it survives the upgrade, on screen",
    upBanner && upgraded.rows.some((r) => r.id === OLD && r.payload.notes === "upgrade e2e" && r.status !== "uploaded"),
    JSON.stringify(upgraded.rows.map((r) => [r.id === OLD, r.status, r.lastError])),
  );

  // --- reminded on every page ------------------------------------------------
  await upPage.goto(`${BASE}/`, { waitUntil: "load" });
  const reminder = upPage.locator("#queue-reminder");
  const reminded = await reminder
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const reminderText = reminded ? await reminder.innerText() : "";
  check(
    "on '/', a reminder says a report is waiting, and how many",
    reminded && reminderText.includes("1 筆通報還沒送出") && reminderText.includes(ZH.offline.reminderSend),
    JSON.stringify(reminderText),
  );
  if (reminded) {
    await reminder.click();
    await upPage.waitForURL((u) => u.pathname === "/report", { timeout: 10000 }).catch(() => {});
  }
  check("and it opens the report page", new URL(upPage.url()).pathname === "/report", upPage.url());
  // The banner says it there, so the reminder does not. It is idle-loaded,
  // so give it the time it would take to appear.
  await upPage.waitForTimeout(5000);
  check("the report page has the banner, not the reminder", (await upPage.locator("#queue-reminder").count()) === 0);

  // The reminder is not in what /map loads before it can draw: its chunk is
  // fetched when the browser is idle (components/offline/QueueReminderLoader).
  const mapHtml = await (await fetch(`${BASE}/map`)).text();
  const mapScripts = [...mapHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  let inFirstLoad = false;
  for (const src of mapScripts) {
    const js = await (await fetch(new URL(src, BASE))).text();
    if (js.includes("queue-reminder")) inFirstLoad = true;
  }
  check(
    "/map's first-load scripts do not carry the reminder",
    mapScripts.length > 0 && !inFirstLoad,
    `${mapScripts.length} scripts`,
  );

  // --- try again, and discard with an undo ---------------------------------
  await upPage.evaluate(async (id) => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("conservation-offline");
      r.onsuccess = () => res(r.result);
    });
    await new Promise((res) => {
      const store = db.transaction("pendingReports", "readwrite").objectStore("pendingReports");
      const get = store.get(id);
      get.onsuccess = () => {
        store.put({ ...get.result, status: "failed", lastError: "validation_failed" });
        store.transaction.oncomplete = () => res();
      };
    });
    db.close();
  }, OLD);
  await upPage.reload({ waitUntil: "load" });
  const statusOf = () =>
    upPage.evaluate(async (id) => {
      const db = await new Promise((res) => {
        const r = indexedDB.open("conservation-offline");
        r.onsuccess = () => res(r.result);
      });
      const row = await new Promise((res) => {
        const req = db.transaction("pendingReports").objectStore("pendingReports").get(id);
        req.onsuccess = () => res(req.result);
      });
      db.close();
      return row?.status ?? null;
    }, OLD);
  const retry = upPage.getByRole("button", { name: new RegExp(`^${ZH.offline.retry}：`) });
  const retryShown = await retry
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (retryShown) await retry.click();
  await upPage.waitForTimeout(1500);
  check("a report the queue gave up on has 再試一次, which puts it back in line", retryShown && (await statusOf()) === "queued", String(await statusOf()));

  const discardOld = upPage.getByRole("button", { name: new RegExp(`^${ZH.offline.discard}：`) });
  await discardOld.click();
  const undo = upPage.getByRole("button", { name: new RegExp(`^${ZH.offline.undo}：`) });
  const undoShown = await undo
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (undoShown) await undo.click();
  await upPage.waitForTimeout(6000);
  check("discarding can be undone, and an undone report stays", undoShown && (await statusOf()) === "queued");
  await discardOld.click();
  await upPage.waitForTimeout(6000);
  check("a discard that is not undone deletes the report after a few seconds", (await statusOf()) === null);

  // From here every send this context makes is counted, and none lands.
  let upPosts = 0;
  await upPage.unroute("**/api/reports");
  await up.route("**/api/reports", (route) => {
    upPosts++;
    return route.abort();
  });
  const discardButton = (p) => p.getByRole("button", { name: new RegExp(`^${ZH.offline.discard}：`) });
  const undoButton = (p) => p.getByRole("button", { name: new RegExp(`^${ZH.offline.undo}：`) });

  // The reminder had counted a report, which is then discarded on the report
  // page; going on to another page, it says nothing is waiting.
  const LAST = crypto.randomUUID();
  nonces.push(LAST);
  await putQueued(upPage, LAST);
  await upPage.reload({ waitUntil: "load" });
  await discardButton(upPage).waitFor({ timeout: 10000 });
  // The reminder is idle-loaded; let it count the report first.
  await upPage.waitForTimeout(5000);
  await discardButton(upPage).click();
  await upPage.waitForTimeout(6500);
  // A link, so that the move is the client-side one that kept the old count.
  await upPage.locator('a[href="/"]').first().click({ timeout: 5000 }).catch(() => {});
  await upPage.waitForURL((u) => u.pathname === "/", { timeout: 10000 }).catch(() => {});
  await upPage.waitForTimeout(2000);
  check(
    "after the last report is discarded, the next page has no reminder",
    new URL(upPage.url()).pathname === "/" && (await upPage.locator("#queue-reminder").count()) === 0 && (await rowOf(upPage, LAST)) === null,
    upPage.url(),
  );

  // Reloaded during the undo: the undo is still there, and the report is
  // neither lost before its seconds are up nor sent.
  const AGAIN = crypto.randomUUID();
  nonces.push(AGAIN);
  await upPage.goto(`${BASE}/report`, { waitUntil: "load" });
  await putQueued(upPage, AGAIN);
  await upPage.reload({ waitUntil: "load" });
  await discardButton(upPage).waitFor({ timeout: 10000 });
  await upPage.waitForTimeout(1500);
  let sentBefore = upPosts;
  await discardButton(upPage).click();
  await undoButton(upPage).waitFor({ timeout: 3000 });
  await upPage.reload({ waitUntil: "load" });
  const undoAfterReload = await undoButton(upPage)
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  const heldThrough = await rowOf(upPage, AGAIN);
  check(
    "a page reloaded during the undo still offers it, and still has the report",
    undoAfterReload && typeof heldThrough?.discardAt === "number",
    JSON.stringify({ undoAfterReload, discardAt: heldThrough?.discardAt ?? null }),
  );
  await upPage.waitForTimeout(6000);
  check(
    "when the undo is up the report is deleted, and it was never sent",
    (await rowOf(upPage, AGAIN)) === null && upPosts === sentBefore,
    `posts during the undo: ${upPosts - sentBefore}`,
  );

  // Closed during the undo: deleted when its seconds are up, by whatever page
  // opens next, and never sent.
  const CLOSED = crypto.randomUUID();
  nonces.push(CLOSED);
  await putQueued(upPage, CLOSED);
  const closing = await up.newPage();
  await closing.goto(`${BASE}/report`, { waitUntil: "load" });
  await discardButton(closing).waitFor({ timeout: 10000 });
  await closing.waitForTimeout(1500);
  sentBefore = upPosts;
  await discardButton(closing).click();
  await undoButton(closing).waitFor({ timeout: 3000 });
  await closing.close();
  // Its sibling tab, still open on /report, must not send it either.
  await upPage.evaluate(() => window.dispatchEvent(new Event("online")));
  await upPage.waitForTimeout(6000);
  await upPage.goto(`${BASE}/`, { waitUntil: "load" });
  await upPage.waitForTimeout(5000);
  check(
    "a tab closed during the undo: the report is deleted once it is up, and never sent",
    (await rowOf(upPage, CLOSED)) === null && upPosts === sentBefore && (await upPage.locator("#queue-reminder").count()) === 0,
    `posts: ${upPosts - sentBefore}`,
  );
  await up.close();

  // --- an old tab holding the database ---------------------------------------
  // The build before version 2 opened the database at version 1, never closed
  // it, and did not close when a newer version asked. Browsers hold an upgrade
  // until every other connection closes, and put every later open in line
  // behind it, so one such tab used to leave a new tab's queue unanswered.
  // With a service worker to ask (lib/offline/db.ts), the new tab sees the
  // other window and leaves the database at version 1.
  const oc = await browser.newContext({ viewport: { width: 500, height: 900 }, locale: "zh-TW" });
  await oc.grantPermissions(["geolocation"], { origin: BASE });
  await oc.route("**/api/reports", (route) => route.abort());
  const oldTab = await oc.newPage();
  // A file of the site with none of its scripts, so it is the old build's
  // connection and nothing else that holds the database.
  await oldTab.goto(`${BASE}/sw.js`, { waitUntil: "load" });
  await oldTab.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  const OLD_TAB = crypto.randomUUID();
  nonces.push(OLD_TAB);
  await beOldTab(oldTab, OLD_TAB);
  const newTab = await oc.newPage();
  await newTab.goto(`${BASE}/report/wildlife`, { waitUntil: "load" });
  const ocBanner = await newTab
    .locator("#queue-waiting")
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check("beside an old tab, the new tab's banner reads the queue", ocBanner);
  await oc.setOffline(true);
  await reassertOffline(oc, newTab);
  const ocPlaced = await placeOn(newTab, oc);
  const ocStarted = Date.now();
  await newTab.getByRole("button", { name: ZH.report.saveOnPhone, exact: true }).click();
  const ocSaved = await newTab
    .getByRole("heading", { name: ZH.offline.queuedTitle })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const ocState = await dbState(newTab);
  for (const r of ocState.rows) nonces.push(r.id);
  check(
    "and saving on the phone finishes, at version 1, the old tab's report kept",
    ocPlaced && ocSaved && ocState.version === 1 && ocState.rows.length === 2 && ocState.rows.some((r) => r.id === OLD_TAB),
    JSON.stringify({ ocPlaced, ocSaved, ms: Date.now() - ocStarted, version: ocState.version, rows: ocState.rows.length }),
  );
  // The old tab closed, the next page that opens alone upgrades.
  await oldTab.close();
  await oc.setOffline(false);
  await newTab.reload({ waitUntil: "load" });
  await newTab.locator("#queue-waiting").waitFor({ timeout: 10000 }).catch(() => {});
  const ocAfter = await dbState(newTab);
  check(
    "once it is closed, the next page upgrades to 2 with both reports",
    ocAfter.version === 2 && ocAfter.rows.length === 2 && ["drafts", "sent"].every((s) => ocAfter.stores.includes(s)),
    JSON.stringify({ version: ocAfter.version, rows: ocAfter.rows.length, stores: ocAfter.stores }),
  );
  await oc.close();

  // With no service worker to ask (an in-app browser, say), the new tab asks
  // for the upgrade, and the old tab holds it. Nothing may hang: the banner
  // and the form say to close the other tab, and when it is closed the queue
  // comes back without a reload.
  const nc = await browser.newContext({ viewport: { width: 500, height: 900 }, locale: "zh-TW", serviceWorkers: "block" });
  await nc.grantPermissions(["geolocation"], { origin: BASE });
  await nc.route("**/api/reports", (route) => route.abort());
  const stuckOld = await nc.newPage();
  await stuckOld.goto(`${BASE}/sw.js`, { waitUntil: "load" });
  const STUCK = crypto.randomUUID();
  nonces.push(STUCK);
  await beOldTab(stuckOld, STUCK);
  const stuckNew = await nc.newPage();
  await stuckNew.goto(`${BASE}/report/wildlife`, { waitUntil: "load" });
  const heldSaid = await stuckNew
    .getByText(ZH.offline.queueHeldList)
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check("held by an old tab, the banner says to close the site's other tabs", heldSaid);
  await nc.setOffline(true);
  await reassertOffline(nc, stuckNew);
  const ncPlaced = await placeOn(stuckNew, nc);
  const ncStarted = Date.now();
  await stuckNew.getByRole("button", { name: ZH.report.saveOnPhone, exact: true }).click();
  const heldAlert = await stuckNew
    .getByText(ZH.offline.queueHeld)
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check(
    "saving on the phone answers within seconds, saying what to do, instead of never answering",
    ncPlaced && heldAlert && Date.now() - ncStarted < 8000,
    JSON.stringify({ ncPlaced, heldAlert, ms: Date.now() - ncStarted }),
  );
  await stuckOld.close();
  const cameBack = await stuckNew
    .locator("#queue-waiting")
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  await stuckNew.getByRole("button", { name: ZH.report.saveOnPhone, exact: true }).click();
  const ncSaved = await stuckNew
    .getByRole("heading", { name: ZH.offline.queuedTitle })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const ncState = await dbState(stuckNew);
  for (const r of ncState.rows) nonces.push(r.id);
  check(
    "when the old tab closes, the queue comes back by itself, upgraded, and saving works",
    cameBack && ncSaved && ncState.version === 2 && ncState.rows.length === 2,
    JSON.stringify({ cameBack, ncSaved, version: ncState.version, rows: ncState.rows.length }),
  );
  await nc.close();

  // --- a report filled in survives the page going ---------------------------
  // Android discards the tab while the camera app is open; a reload is the
  // same thing as far as the page can tell.
  const dr = await browser.newContext({ viewport: { width: 500, height: 900 }, locale: "zh-TW" });
  await dr.grantPermissions(["geolocation"], { origin: BASE });
  await dr.setGeolocation({ latitude: 23.75, longitude: 120.95, accuracy: 30 });
  const d = await dr.newPage();
  // The model is a GPU the project pays for, and not what this is about.
  await d.route("**/api/identify", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ band: "low", suggestions: [], outsidePage: null }),
    }),
  );
  await d.goto(`${BASE}/report/roadkill`, { waitUntil: "load" });
  await d
    .locator('input[type="file"]')
    .first()
    .setInputFiles(join(import.meta.dirname, "..", "public", "home", "muntjac.webp"));
  await d.locator("img[src^='blob:']").first().waitFor({ timeout: 15000 });
  for (let i = 0; i < 4; i++) {
    await d.getByRole("button", { name: ZH.report.useMyLocation }).click({ timeout: 2000 }).catch(() => {});
    if (await d.getByText(ZH.report.tapToAdjust).waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) break;
  }
  await d.getByRole("button", { name: ZH.report.condition.roadkill, exact: true }).click();
  await d.locator("#notes").fill("draft e2e note");
  await d.locator("#email").fill("draft-e2e@example.org");
  // Written after a pause in typing.
  await d.waitForTimeout(1000);
  // The browser asks before a page with a report in it is reloaded.
  const onReload = (dialog) => void dialog.accept();
  d.on("dialog", onReload);
  await d.reload({ waitUntil: "load" });
  d.off("dialog", onReload);
  const restored = await d
    .getByText(ZH.report.draftRestored)
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  await d.locator("img[src^='blob:']").first().waitFor({ timeout: 5000 }).catch(() => {});
  const back = {
    notes: await d.locator("#notes").inputValue(),
    email: await d.locator("#email").inputValue(),
    photos: await d.locator("img[src^='blob:']").count(),
    dead: await d.getByRole("button", { name: ZH.report.condition.roadkill, exact: true }).getAttribute("aria-pressed"),
    placed: await d.getByText(ZH.report.tapToAdjust).isVisible(),
  };
  check(
    "a report filled in with a photo comes back after a reload, all of it",
    restored &&
      back.notes === "draft e2e note" &&
      back.email === "draft-e2e@example.org" &&
      back.photos === 1 &&
      back.dead === "true" &&
      back.placed,
    JSON.stringify({ restored, ...back }),
  );

  // A link to another page asks first.
  let linkAsked = "";
  d.once("dialog", (dialog) => {
    linkAsked = dialog.message();
    void dialog.dismiss();
  });
  await d.locator('a[href="/terms"]').first().click();
  await d.waitForTimeout(1000);
  check(
    "a link off the page asks first, and staying stays",
    linkAsked === ZH.report.leaveConfirm && new URL(d.url()).pathname === "/report/roadkill",
    JSON.stringify(linkAsked),
  );

  // So does the language switch, which goes without a link.
  const english = d.locator('button[lang="en"]:visible').first();
  let switchAsked = "";
  d.once("dialog", (dialog) => {
    switchAsked = dialog.message();
    void dialog.dismiss();
  });
  await english.click();
  await d.waitForTimeout(1000);
  check(
    "the language switch asks first while there is a report on the page",
    switchAsked === ZH.report.switchLanguageConfirm && !new URL(d.url()).pathname.startsWith("/en"),
    JSON.stringify(switchAsked),
  );
  d.once("dialog", (dialog) => void dialog.accept());
  await english.click();
  await d.waitForURL((u) => u.pathname === "/en/report/roadkill", { timeout: 10000 }).catch(() => {});
  const switched = await d
    .getByText(EN.report.draftRestored)
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check(
    "and switching keeps the report, in the other language",
    switched && (await d.locator("#notes").inputValue()) === "draft e2e note",
    d.url(),
  );

  // Cleared, it is gone, from this tab and from the database.
  await d
    .getByRole("status")
    .filter({ hasText: EN.report.draftRestored })
    .getByRole("button", { name: EN.report.draftClear, exact: true })
    .click();
  await d.waitForTimeout(1000);
  const left = await d.evaluate(async () => {
    const keys = Object.keys(sessionStorage).filter((k) => k.startsWith("report-draft:"));
    const db = await new Promise((res) => {
      const r = indexedDB.open("conservation-offline");
      r.onsuccess = () => res(r.result);
    });
    const photos = await new Promise((res) => {
      const req = db.transaction("drafts").objectStore("drafts").count();
      req.onsuccess = () => res(req.result);
    });
    db.close();
    return { keys, photos, notes: document.querySelector("#notes")?.value ?? null };
  });
  check(
    "清除 empties the form and forgets the draft",
    left.keys.length === 0 && left.photos === 0 && left.notes === "" && !(await d.getByText(EN.report.draftRestored).isVisible()),
    JSON.stringify(left),
  );
  await dr.close();
} finally {
  await sql`delete from reports where client_nonce = any(${nonces})`;
  await sql.end();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
