/**
 * A report half filled in, kept so that losing the page does not lose it.
 *
 * lib/offline/drafts.ts, run in node over an in-memory IndexedDB
 * (fixtures/fake-idb.mjs) and a stand-in sessionStorage: what comes back, for
 * how long, and that a draft only ever gets its own photographs. The form
 * using it is run in a browser by e2e/offline.spec.mjs, which fills one in
 * with a photo, reloads, and finds all of it.
 *
 *   node --test test/offline-drafts.test.mjs
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const WEB = join(import.meta.dirname, "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "idb")
      return { url: pathToFileURL(join(import.meta.dirname, "fixtures", "fake-idb.mjs")).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

/** sessionStorage as a tab has it, minus the quota. */
const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const drafts = await import("../lib/offline/drafts.ts");
const { DRAFT_TTL_MS } = drafts;

const photo = (id) => ({
  id,
  blob: { size: 3, type: "image/webp" },
  width: 4,
  height: 3,
  gps: null,
  takenAt: new Date("2026-10-22T07:32:00+08:00"),
});

beforeEach(async () => {
  await drafts.forgetDrafts();
  store.clear();
});

describe("the fields", () => {
  test("come back for the page they were typed on, and only that one", () => {
    drafts.saveDraftFields("roadkill", { nonce: "n1", notes: "左後腳受傷" });
    assert.deepEqual(drafts.loadDraftFields("roadkill"), { nonce: "n1", notes: "左後腳受傷" });
    assert.equal(drafts.loadDraftFields("invasive"), null);
    assert.equal(drafts.loadDraftFields("roadkill:test"), null, "a moderator's test form got a real draft");
  });

  test("are dropped after a day", () => {
    drafts.saveDraftFields("roadkill", { nonce: "n1" });
    assert.equal(drafts.loadDraftFields("roadkill", Date.now() + DRAFT_TTL_MS + 1), null);
    assert.equal(store.size, 0, "a stale draft was left behind");
  });

  test("a store that refuses, or holds rubbish, is not the form's problem", () => {
    store.set("report-draft:roadkill", "{not json");
    assert.equal(drafts.loadDraftFields("roadkill"), null);
    const setItem = globalThis.sessionStorage.setItem;
    globalThis.sessionStorage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    try {
      assert.doesNotThrow(() => drafts.saveDraftFields("roadkill", { nonce: "n1" }));
    } finally {
      globalThis.sessionStorage.setItem = setItem;
    }
  });
});

describe("the photographs", () => {
  test("are kept under the draft's own id, so another tab's draft never gets them", async () => {
    await drafts.saveDraftPhotos("tab-a", [photo("p1"), photo("p2")]);
    await drafts.saveDraftPhotos("tab-b", [photo("p3")]);
    const a = await drafts.loadDraftPhotos("tab-a");
    assert.deepEqual(a.map((p) => p.id), ["p1", "p2"]);
    assert.ok(a[0].takenAt instanceof Date, "the time a photo was taken came back as something else");
    assert.deepEqual((await drafts.loadDraftPhotos("tab-b")).map((p) => p.id), ["p3"]);
  });

  test("an empty list deletes them, and so does dropping the draft", async () => {
    await drafts.saveDraftPhotos("tab-a", [photo("p1")]);
    await drafts.saveDraftPhotos("tab-a", []);
    assert.deepEqual(await drafts.loadDraftPhotos("tab-a"), []);
    await drafts.saveDraftPhotos("tab-a", [photo("p1")]);
    await drafts.dropDraftPhotos("tab-a");
    assert.deepEqual(await drafts.loadDraftPhotos("tab-a"), []);
  });

  test("those of a tab that was closed are swept after a day", async () => {
    await drafts.saveDraftPhotos("closed-tab", [photo("p1")]);
    await drafts.purgeDraftPhotos(Date.now() + DRAFT_TTL_MS - 1000);
    assert.equal((await drafts.loadDraftPhotos("closed-tab")).length, 1, "swept before a day was up");
    await drafts.purgeDraftPhotos(Date.now() + DRAFT_TTL_MS + 1000);
    assert.equal((await drafts.loadDraftPhotos("closed-tab", 0)).length, 0);
  });
});

describe("signing out", () => {
  test("forgets every draft on the device, the fields of this tab and every photograph", async () => {
    drafts.saveDraftFields("roadkill", { nonce: "n1" });
    drafts.saveDraftFields("wildlife", { nonce: "n2" });
    store.set("something-else", "kept");
    await drafts.saveDraftPhotos("n1", [photo("p1")]);
    await drafts.forgetDrafts();
    assert.deepEqual([...store.keys()], ["something-else"]);
    assert.deepEqual(await drafts.loadDraftPhotos("n1"), []);
  });
});

describe("the form", () => {
  const form = readFileSync(join(WEB, "components", "report", "ReportForm.tsx"), "utf8");

  test("clears the draft once the report is sent, saved, or started again", () => {
    assert.match(form, /if \(!open\) forgetDraft\(\);/);
    assert.match(form, /const open = phase !== "done" && phase !== "queued";/);
    assert.equal((form.match(/forgetDraft\(\);\s+onReportAnother\(\);/g) ?? []).length, 2, "清除 and 再通報一筆");
  });

  test("writes nothing over a draft before it is back", () => {
    assert.match(form, /if \(!draftLoaded \|\| !open \|\| dropped\.current\) return;/);
  });

  test("asks before leaving while it has entries, in the capture phase", () => {
    assert.match(form, /window\.addEventListener\("beforeunload", onBeforeUnload\);/);
    assert.match(form, /document\.addEventListener\("click", onClick, true\);/);
    assert.match(form, /window\.confirm\(t\("leaveConfirm"\)\)/);
    const switcher = readFileSync(join(WEB, "components", "LanguageSwitcher.tsx"), "utf8");
    assert.match(switcher, /wouldLoseEntries\(\) && !window\.confirm\(t\("switchLanguageConfirm"\)\)/);
  });
});
