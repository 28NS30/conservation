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
      // Talk to IndexedDB directly with the same schema the app uses.
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("conservation-offline", 1);
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
 * The database version is still 1 on purpose. IndexedDB stores structured
 * clones and enforces no per-field schema, so adding fields to the stored
 * object needs no upgrade; only a new store or index would.
 */
const rows = () =>
  page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("conservation-offline", 1);
      r.onsuccess = () => res(r.result);
    });
    return new Promise((res) => {
      const tx = db.transaction("pendingReports", "readonly");
      const req = tx.objectStore("pendingReports").getAll();
      req.onsuccess = () => res(req.result);
    });
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
      banner = await page
        .locator("#queue-waiting")
        .waitFor({ timeout: 8000 })
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
      const c = await caches.open("shell-v2");
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
} finally {
  await sql`delete from reports where client_nonce = any(${nonces})`;
  await sql.end();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
