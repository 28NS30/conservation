/**
 * The offline queue never strands a report because the server had a bad day.
 *
 * A report used to be written off after eight attempts, and a 5xx cost one, so
 * a morning of server errors turned sound reports into `failed` ones its
 * reporter could only throw away. These run the queue itself — lib/offline's
 * real flush and queue, over an in-memory IndexedDB (fixtures/fake-idb.mjs)
 * and a fetch that answers as the server would — and hold it to the rules at
 * the top of lib/offline/flush.ts: what costs an attempt, how long a report
 * waits after each answer, and the only two ways it is ever given up on.
 *
 * test/offline-challenge.test.mjs, beside this, pins the challenge contract at
 * the source level; e2e/offline.spec.mjs runs the queue in a browser.
 *
 *   node --test test/offline-retry.test.mjs
 */
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const WEB = join(import.meta.dirname, "..");
const fixture = (name) => pathToFileURL(join(import.meta.dirname, "fixtures", name)).href;

// The app's own module graph, as the bundler resolves it: `@/` is the app's
// root, a relative import may leave off `.ts`, and the two modules that would
// need a browser are swapped for stand-ins.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "idb") return { url: fixture("fake-idb.mjs"), shortCircuit: true };
    if (specifier === "@/lib/report/upload") return { url: fixture("stub-upload.mjs"), shortCircuit: true };
    const spec = specifier.startsWith("@/") ? pathToFileURL(join(WEB, specifier.slice(2))).href : specifier;
    try {
      return nextResolve(spec, context);
    } catch (e) {
      if (/^(\.|file:)/.test(spec) && !/\.[cm]?[jt]sx?$/.test(spec)) return nextResolve(`${spec}.ts`, context);
      throw e;
    }
  },
});

// No challenge, as in local development: the token path has its own tests.
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "";
const {
  enqueue,
  getQueued,
  updateQueued,
  retryQueued,
  listQueued,
  removeQueued,
  discardQueued,
  keepQueued,
  countWaiting,
} = await import("../lib/offline/queue.ts");
const { flushQueue, retryAt, GIVE_UP_AFTER_MS, LONGEST_WAIT_MS } = await import(
  "../lib/offline/flush.ts"
);
const { listSent, forgetSent } = await import("../lib/offline/sent.ts");

const MINUTE = 60_000;

/** What the server will answer next, and how many times it was asked. */
let answer = () => new Response("{}", { status: 503 });
let posts = 0;
globalThis.fetch = async (url) => {
  if (String(url).endsWith("/api/reports")) posts++;
  return answer();
};
const json = (status, body) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const queue = (extra = {}) =>
  enqueue({
    id: randomUUID(),
    payload: {
      category: "roadkill",
      page: "roadkill",
      lng: 120.95,
      lat: 23.75,
      observedAt: new Date().toISOString(),
    },
    photos: [],
    ...extra,
  });

beforeEach(async () => {
  for (const r of await listQueued()) await removeQueued(r.id);
  await forgetSent();
  posts = 0;
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-22T08:00:00Z") });
});
afterEach(() => mock.timers.reset());

describe("an answer from the server is never the report's fault", () => {
  test("ten 503s leave the report queued, its attempts unspent", async () => {
    const { id } = await queue();
    answer = json(503, { error: "storage_unavailable" });
    for (let i = 0; i < 10; i++) {
      // Each try waits out the one before; see the next test.
      mock.timers.tick(LONGEST_WAIT_MS);
      await flushQueue();
    }
    const item = await getQueued(id);
    assert.equal(posts, 10, "every flush should have asked the server");
    assert.equal(item.status, "queued");
    assert.equal(item.attempts, 0, "a server error spent an attempt");
    assert.equal(item.retries, 10);
    assert.equal(item.lastError, "storage_unavailable");
  });

  test("so does a stale challenge, and so does a 500 from signing", async () => {
    const { id } = await queue();
    answer = json(403, { error: "challenge_failed" });
    await flushQueue();
    let item = await getQueued(id);
    assert.equal(item.status, "queued");
    assert.equal(item.attempts, 0);
    answer = json(500, { error: "insert_failed" });
    await flushQueue(undefined, { force: true });
    item = await getQueued(id);
    assert.equal(item.status, "queued");
    assert.equal(item.attempts, 0);
  });

  test("no signal costs nothing and sets no wait, so it goes the moment there is some", async () => {
    const { id } = await queue();
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    try {
      await flushQueue();
      const item = await getQueued(id);
      assert.equal(item.status, "queued");
      assert.equal(item.attempts, 0);
      assert.equal(item.lastError, "network");
      assert.equal(retryAt(item), 0, "no signal made the report wait");
    } finally {
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/api/reports")) posts++;
        return answer();
      };
    }
  });
});

describe("after an answer, the next automatic try waits", () => {
  test("2^n minutes after the last answer, never more than six hours", () => {
    assert.equal(retryAt({}), 0);
    assert.equal(retryAt({ lastTriedAt: 1_000, retries: 1 }), 1_000 + 2 * MINUTE);
    assert.equal(retryAt({ lastTriedAt: 1_000, retries: 5 }), 1_000 + 32 * MINUTE);
    assert.equal(retryAt({ lastTriedAt: 1_000, retries: 8 }), 1_000 + 256 * MINUTE);
    assert.equal(retryAt({ lastTriedAt: 1_000, retries: 9 }), 1_000 + LONGEST_WAIT_MS);
    assert.equal(retryAt({ lastTriedAt: 1_000, retries: 40 }), 1_000 + LONGEST_WAIT_MS);
  });

  test("a flush inside the wait leaves it alone; one after it, or a person pressing send, does not", async () => {
    const { id } = await queue();
    answer = json(503, {});
    await flushQueue();
    assert.equal(posts, 1);

    const early = await flushQueue();
    assert.equal(posts, 1, "asked again inside the wait");
    assert.equal(early.deferred, 1);
    assert.equal(early.remaining, 1);

    mock.timers.tick(2 * MINUTE);
    await flushQueue();
    assert.equal(posts, 2, "not asked again once the wait was up");

    await flushQueue(undefined, { force: true });
    assert.equal(posts, 3, "the send button waited");
    assert.equal((await getQueued(id)).retries, 3);
  });
});

describe("the only two ways a report is given up on", () => {
  test("a 4xx that says the report is wrong", async () => {
    const { id } = await queue();
    answer = json(400, { error: "validation_failed" });
    await flushQueue();
    const item = await getQueued(id);
    assert.equal(item.status, "failed");
    assert.equal(item.lastError, "validation_failed");
  });

  test("fourteen days of the server failing on it, and 再試一次 starts the fourteen days again", async () => {
    const { id } = await queue();
    answer = json(503, {});
    await flushQueue();
    mock.timers.tick(GIVE_UP_AFTER_MS - MINUTE);
    await flushQueue();
    assert.equal((await getQueued(id)).status, "queued", "given up before fourteen days");

    mock.timers.tick(LONGEST_WAIT_MS);
    await flushQueue();
    assert.equal((await getQueued(id)).status, "failed");

    // Failed is not sent by itself any more...
    const before = posts;
    await flushQueue(undefined, { force: true });
    assert.equal(posts, before, "a report the queue gave up on was sent anyway");

    // ...until its reporter asks.
    await retryQueued(id);
    let item = await getQueued(id);
    assert.equal(item.status, "queued");
    assert.equal(item.retries, 0);
    assert.equal(retryAt(item), 0, "a retried report still had a wait to sit out");
    await flushQueue();
    item = await getQueued(id);
    assert.equal(posts, before + 1);
    assert.equal(item.status, "queued", "the fourteen days were not started again");
  });

  test("not fourteen days from the save: a report carried three weeks with no signal is tried", async () => {
    const { id } = await queue();
    // Twenty days on a trip, every flush finding no network.
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    try {
      for (let day = 0; day < 20; day++) {
        mock.timers.tick(24 * 3600 * 1000);
        await flushQueue();
      }
    } finally {
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/api/reports")) posts++;
        return answer();
      };
    }
    // Then signal, and a server having a bad morning.
    answer = json(503, {});
    await flushQueue();
    const item = await getQueued(id);
    assert.equal(posts, 1);
    assert.equal(item.status, "queued", "given up on at its first answer, for having been saved long ago");
    assert.equal(item.attempts, 0);
  });
});

describe("what a flush does with the rest", () => {
  test("a report being discarded is not sent during its undo, by any flush, and undone it is", async () => {
    const { id } = await queue();
    answer = json(201, { id: randomUUID(), status: "published", visible: true });
    // The discard is on the row, so this holds for a flush in any tab, and for
    // the page that opens after the one it was pressed on was closed.
    await discardQueued(id, Date.now() + 5_000);
    await flushQueue(undefined, { force: true });
    assert.equal(posts, 0, "a report its reporter had just discarded was sent");
    assert.equal(await countWaiting(), 0, "the reminder still counts a discarded report");
    assert.ok(await getQueued(id), "deleted before its undo was over");

    await keepQueued(id);
    assert.equal(await countWaiting(), 1);
    await flushQueue();
    assert.equal((await getQueued(id)).status, "uploaded");
  });

  test("once the undo is over, the next look deletes it, and it was never sent", async () => {
    const { id } = await queue();
    answer = json(201, { id: randomUUID(), status: "published", visible: true });
    await discardQueued(id, Date.now() + 5_000);
    // The page it was discarded on is gone; a flush starts somewhere later.
    mock.timers.tick(6_000);
    await flushQueue();
    assert.equal(posts, 0);
    assert.equal(await getQueued(id), undefined, "a discard that had become final was not finished");
  });

  test("the reminder's count finishes a final discard too", async () => {
    const { id } = await queue();
    await discardQueued(id, Date.now() + 5_000);
    mock.timers.tick(6_000);
    assert.equal(await countWaiting(), 0);
    assert.equal(await getQueued(id), undefined);
  });

  test("a report discarded from another tab while its photos go up is not filed, and its undo still works", async () => {
    const { id } = await queue({ photos: [new Blob(["x"], { type: "image/webp" })] });
    let signed = false;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith("/api/uploads/sign")) {
        signed = true;
        // Pressed in another tab, between the signing and the post.
        await discardQueued(id, Date.now() + 5_000);
        return new Response(JSON.stringify({ uploads: [{ path: "p/1.webp", token: "t" }] }), { status: 200 });
      }
      if (u.endsWith("/api/reports")) posts++;
      return answer();
    };
    try {
      answer = json(201, { id: randomUUID(), status: "published", visible: true });
      await flushQueue();
      assert.ok(signed);
      assert.equal(posts, 0, "filed while being discarded");
      const item = await getQueued(id);
      assert.equal(item.status, "queued");
      assert.equal(item.attempts, 0, "the send it never made cost an attempt");
    } finally {
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/api/reports")) posts++;
        return answer();
      };
    }
  });

  test("a sent report is written down on the phone, and a moderator's test is not", async () => {
    const real = randomUUID();
    const trial = randomUUID();
    await queue({ label: "白鼻心" });
    answer = json(201, { id: real, status: "pending", visible: true });
    await flushQueue();
    const q = await queue();
    await updateQueued(q.id, { payload: { ...q.payload, test: true } });
    answer = json(201, { id: trial, status: "published", visible: true });
    await flushQueue();

    const sent = await listSent();
    assert.deepEqual(
      sent.map((s) => [s.id, s.page, s.category, s.label]),
      [[real, "roadkill", "roadkill", "白鼻心"]],
    );
  });
});
