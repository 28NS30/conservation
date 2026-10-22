/**
 * The move to https://formosawatch.biowatchitnl.org, October 2026.
 *
 *   - The old host, preservation-web-one.vercel.app, served a full duplicate of
 *     the site. It now answers a page with a 308 to the same path and query on
 *     the new host, and everything a queued report needs keeps answering on it
 *     (proxy.ts).
 *   - A report saved on a phone under the old host can only be sent from a page
 *     open there, so the old host's service worker asks to stay while one is
 *     unsent, and the proxy lets it (public/sw.js).
 *   - The canonical origin fell back to Vercel's production hostname, which can
 *     be the bare apex now, and the apex only redirects (lib/siteUrl.ts).
 *   - Every Chinese share card answered 307: the locale routing dropped the
 *     /zh-TW from the card's own path.
 *
 * The proxy is driven over HTTP with the old host's Host header, which fetch
 * will not send; nothing else can tell the two hosts apart.
 *
 *   TEST_BASE_URL=http://localhost:3000 node --test test/site-move.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { BASE_URL } from "./helpers.mjs";

const WEB = join(import.meta.dirname, "..");
const OLD_HOST = "preservation-web-one.vercel.app";
const CANONICAL = "https://formosawatch.biowatchitnl.org";

async function server() {
  return (await fetch(BASE_URL).catch(() => null)) !== null;
}

/** One request to the test server, as if it had been made to `host`. */
function asHost(host, path, { method = "GET", headers = {} } = {}) {
  const base = new URL(BASE_URL);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: base.hostname, port: base.port, path, method, headers: { host, ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.setTimeout(60_000, () => req.destroy(new Error(`timed out: ${method} ${path}`)));
    req.on("error", reject);
    req.end();
  });
}
const old = (path, opts) => asHost(OLD_HOST, path, opts);

describe("a page asked for on the old host", () => {
  test("moves, with a 308, to the same path and query on the new host", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    for (const path of [
      "/",
      "/about",
      "/en/about",
      "/zh-TW/about",
      "/species?filter=protected",
      "/en/species?filter=protected&page=2",
      `/species/${encodeURIComponent("石虎")}`,
    ]) {
      const res = await old(path);
      assert.equal(res.status, 308, `${path} answered ${res.status}`);
      assert.equal(res.headers.location, `${CANONICAL}${path}`, path);
    }
  });

  test("moves for HEAD too", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const res = await old("/report", { method: "HEAD" });
    assert.equal(res.status, 308);
    assert.equal(res.headers.location, `${CANONICAL}/report`);
  });

  test("does not move on any other host", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    for (const host of [new URL(BASE_URL).host, new URL(CANONICAL).host]) {
      const res = await asHost(host, "/about");
      assert.equal(res.status, 200, `${host} answered ${res.status}`);
    }
  });

  test("stays for a phone whose service worker says reports are unsent", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    for (const path of ["/report", "/en/report/roadkill", "/"]) {
      const res = await old(path, { headers: { "x-unsent-reports": "1" } });
      assert.equal(res.status, 200, `${path} answered ${res.status}`);
    }
  });

  test("moves a browser's navigation, and a script's fetch from anywhere else", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    for (const headers of [
      { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "none" },
      { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "same-origin" },
      { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", "sec-fetch-site": "cross-site" },
      // What Node's fetch sends, as verify-deploy does.
      { "sec-fetch-mode": "cors" },
    ]) {
      const res = await old("/map", { headers });
      assert.equal(res.status, 308, JSON.stringify(headers));
      assert.equal(res.headers.location, `${CANONICAL}/map`);
    }
  });

  test("stays for a tab already open there: Next's own fetches and a server action's post", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    // What a browser sends with them. Next hides the RSC headers from the
    // proxy, so Sec-Fetch-Mode is what tells a fetch from a navigation.
    const fetched = { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", "sec-fetch-site": "same-origin" };
    const rsc = await old("/about?_rsc=abc12", { headers: { ...fetched, rsc: "1" } });
    assert.notEqual(rsc.status, 308, "an RSC fetch was moved");
    const prefetch = await old("/about?_rsc=abc12", { headers: { ...fetched, rsc: "1", "next-router-prefetch": "1" } });
    assert.notEqual(prefetch.status, 308, "a prefetch was moved");
    const post = await old("/about", { method: "POST", headers: { "content-type": "text/plain" } });
    assert.notEqual(post.status, 308, "a post was moved");
  });
});

describe("what a queued report needs still answers on the old host", () => {
  test("the API, the service worker, the manifest and static files", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    for (const path of ["/api/health", "/sw.js", "/manifest.webmanifest", "/robots.txt", "/brand-badge.png"]) {
      const res = await old(path);
      assert.equal(res.status, 200, `${path} answered ${res.status}`);
    }
  });

  test("Next's scripts", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const html = await (await fetch(`${BASE_URL}/report`)).text();
    const chunk = /\/_next\/static\/[^"']+\.js/.exec(html)?.[0];
    assert.ok(chunk, "no script on /report");
    const res = await old(chunk);
    assert.equal(res.status, 200, `${chunk} answered ${res.status}`);
  });

  test("the sign-in callback is not moved", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const res = await old("/auth/callback");
    assert.ok(!(res.headers.location ?? "").startsWith(CANONICAL), `moved to ${res.headers.location}`);
  });
});

describe("a share card", () => {
  /** The path of the og:image a page names, asked of this server. */
  async function card(page) {
    const html = await (await fetch(`${BASE_URL}${page}`, { redirect: "follow" })).text();
    const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    assert.ok(og, `${page} names no og:image`);
    const u = new URL(og);
    return u.pathname + u.search;
  }

  async function aSpeciesPage() {
    const xml = await (await fetch(`${BASE_URL}/sitemap.xml`)).text();
    const loc = [...xml.matchAll(/<loc>([^<]+\/species\/[^<]+)<\/loc>/g)][0]?.[1];
    return loc ? new URL(loc).pathname : null;
  }

  test("is the image itself, not a redirect, in both languages", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const species = await aSpeciesPage();
    const pages = ["/", "/en", ...(species ? [species, `/en${species}`] : [])];
    if (!species) t.diagnostic("no species page in this sitemap; checked the site card only");
    for (const page of pages) {
      const path = await card(page);
      const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
      assert.equal(res.status, 200, `${page}: ${path} answered ${res.status} ${res.headers.get("location") ?? ""}`);
      assert.equal(res.headers.get("content-type"), "image/png", `${page}: ${path}`);
      await res.arrayBuffer();
      if (page === "/") assert.match(path, /^\/zh-TW\//, "the Chinese card is named under /zh-TW, which is what used to 307");
    }
  });

  test("answers on the old host too, since pages there name it", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const path = await card("/");
    const res = await old(path);
    assert.equal(res.status, 200, `${path} answered ${res.status}`);
  });
});

describe("the site's address", () => {
  // A module instance per environment: the address is read once, at import.
  let n = 0;
  async function siteUrlWith(env) {
    const keys = ["NEXT_PUBLIC_SITE_URL", "VERCEL", "VERCEL_PROJECT_PRODUCTION_URL"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, env);
    try {
      return (await import(`../lib/siteUrl.ts?env=${n++}`)).SITE_URL;
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }

  test("is NEXT_PUBLIC_SITE_URL when it is set", async () => {
    assert.equal(await siteUrlWith({ NEXT_PUBLIC_SITE_URL: "https://example.test", VERCEL: "1" }), "https://example.test");
  });

  test("on Vercel without it, is the site's own address, not Vercel's production hostname", async () => {
    // The shortest production domain, which is what Vercel puts here: the apex,
    // which only redirects.
    const url = await siteUrlWith({ VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "biowatchitnl.org" });
    assert.equal(url, CANONICAL);
  });

  test("is localhost anywhere else, and an empty variable counts as unset", async () => {
    assert.equal(await siteUrlWith({}), "http://localhost:3000");
    assert.equal(await siteUrlWith({ NEXT_PUBLIC_SITE_URL: "" }), "http://localhost:3000");
  });
});

/**
 * public/sw.js run in a sandbox, with stand-ins for what a browser gives it: a
 * cache that is always empty, a network that records what it was asked, and
 * an IndexedDB holding the given queue rows (or no database at all).
 */
function worker({ hostname, rows }) {
  const listeners = {};
  const sent = [];
  const db = { exists: rows !== undefined, created: false, closed: 0 };

  const cache = { match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => true };
  const indexedDB = {
    open(name) {
      const open = {};
      setTimeout(() => {
        if (name !== "conservation-offline" || !db.exists) {
          let aborted = false;
          open.transaction = { abort: () => (aborted = true) };
          open.onupgradeneeded?.({ oldVersion: 0 });
          if (aborted) return open.onerror?.();
          db.created = true;
        }
        const list = rows ?? [];
        open.result = {
          objectStoreNames: { contains: (s) => db.exists && s === "pendingReports" },
          transaction: () => ({
            objectStore: () => ({
              openCursor() {
                const cur = {};
                let i = 0;
                const step = () =>
                  setTimeout(() => {
                    cur.result = i < list.length ? { value: list[i], continue: () => (i++, step()) } : null;
                    cur.onsuccess?.();
                  });
                step();
                return cur;
              },
            }),
          }),
          close: () => db.closed++,
        };
        open.onsuccess?.();
      });
      return open;
    },
  };

  const origin = `https://${hostname}`;
  const self = {
    location: new URL(`${origin}/sw.js`),
    registration: { scope: `${origin}/` },
    addEventListener: (type, fn) => (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {}, matchAll: async () => [] },
  };
  const context = vm.createContext({
    self,
    caches: { open: async () => cache, match: async () => undefined, keys: async () => [], delete: async () => true },
    indexedDB,
    fetch: async (request) => {
      sent.push(request);
      return new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
    },
    Headers,
    Request,
    Response,
    URL,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(readFileSync(join(WEB, "public", "sw.js"), "utf8"), context);

  /** A page navigation to `path`, and what the network was asked for it. */
  async function navigate(path) {
    const request = {
      url: `${origin}${path}`,
      mode: "navigate",
      method: "GET",
      credentials: "include",
      redirect: "manual",
      headers: new Headers({ accept: "text/html" }),
    };
    let answer = null;
    listeners.fetch({ request, respondWith: (p) => (answer = p) });
    if (answer) await answer;
    return { handled: answer !== null, asked: sent.at(-1), original: request };
  }
  return { navigate, db };
}

const QUEUED = { id: "a", status: "queued" };
const RECEIPT = { id: "b", status: "uploaded" };

describe("the old host's service worker", () => {
  const asksToStay = (r) => r?.headers?.get?.("x-unsent-reports") === "1";

  test("asks to stay while a report is unsent, for a report page and any other", async () => {
    const sw = worker({ hostname: OLD_HOST, rows: [RECEIPT, QUEUED] });
    for (const path of ["/report", "/en/report/roadkill", "/", "/map", "/me", "/reports/123"]) {
      const { handled, asked } = await sw.navigate(path);
      assert.ok(handled, `${path} was not handled`);
      assert.ok(asksToStay(asked), `${path} did not ask to stay`);
      assert.equal(asked.url, `https://${OLD_HOST}${path}`);
      // Past any 308 the browser kept, and still a navigation's redirect, so
      // the browser follows one the server does send.
      assert.equal(asked.cache, "no-store", path);
      assert.equal(asked.redirect, "manual", path);
      assert.equal(asked.credentials, "include", path);
    }
    assert.ok(sw.db.closed > 0, "the database was left open");
  });

  test("a report that failed for good is still unsent", async () => {
    const sw = worker({ hostname: OLD_HOST, rows: [{ id: "c", status: "failed" }] });
    assert.ok(asksToStay((await sw.navigate("/report")).asked));
  });

  test("follows the move once only receipts are left", async () => {
    const sw = worker({ hostname: OLD_HOST, rows: [RECEIPT] });
    const { asked, original } = await sw.navigate("/report");
    assert.equal(asked, original, "the navigation was rewritten");
  });

  test("on a phone that never saved a report, follows the move and creates no database", async () => {
    const sw = worker({ hostname: OLD_HOST, rows: undefined });
    const { asked, original } = await sw.navigate("/report");
    assert.equal(asked, original);
    assert.equal(sw.db.created, false, "an empty database would break the page's own upgrade");
  });

  test("does nothing of the kind on the new host", async () => {
    const sw = worker({ hostname: new URL(CANONICAL).hostname, rows: [QUEUED] });
    const report = await sw.navigate("/report");
    assert.equal(report.asked, report.original);
    // A page outside the offline set is still left to the browser there.
    assert.equal((await sw.navigate("/me")).handled, false);
  });
});
