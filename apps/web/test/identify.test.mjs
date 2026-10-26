/**
 * What POST /api/identify does with a photo, against a model that answers
 * the same way every time (test/stub-ml.mjs).
 *
 * The first half runs the route and lib/report/identify.ts in this process,
 * over the real database, with the stand-in on a port of its own: so both of
 * the model's contracts are run, whichever one a server was started with, and
 * the challenge can be switched on, which no server here has. The second half
 * asks the running server, which CI points at the stand-in, as a browser does.
 *
 *   node --test test/identify.test.mjs
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomInt } from "node:crypto";
import { sql, BASE_URL, IN_CI, requireServer } from "./helpers.mjs";
import { CANDIDATES, isStubMl, startStubMl } from "./stub-ml.mjs";
import { addressKey } from "../lib/request.ts";

/** Whatever the running server was pointed at, read before this file points elsewhere. */
const SERVER_ML = process.env.ML_ENDPOINT_URL;

const WEB = join(import.meta.dirname, "..");
const empty = "data:text/javascript,export {};";

// The app's module graph as the bundler resolves it, with the two modules a
// request would need Next for swapped out: nobody is signed in here.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: empty, shortCircuit: true };
    if (specifier === "@/lib/supabase/server")
      return { url: "data:text/javascript,export const currentUserId = async () => null;", shortCircuit: true };
    const spec = specifier.startsWith("@/") ? pathToFileURL(join(WEB, specifier.slice(2))).href : specifier;
    try {
      return nextResolve(spec, context);
    } catch (e) {
      if (/^(\.|file:)/.test(spec) && !/\.[cm]?[jt]sx?$/.test(spec)) return nextResolve(`${spec}.ts`, context);
      throw e;
    }
  },
});

const TOKEN = "stub-ml-test-token";
const ml = await startStubMl({ token: TOKEN });
process.env.ML_ENDPOINT_URL = ml.url;
process.env.ML_ENDPOINT_TOKEN = TOKEN;

const { POST } = await import("../app/api/identify/route.ts");
const { identifyPhoto } = await import("../lib/report/identify.ts");
const { ModelRefused } = await import("../lib/report/model.ts");
const { sql: appSql } = await import("../lib/db.ts");

/** Cloudflare, as far as verifyTurnstile can tell: "good" passes, anything else fails. */
const realFetch = globalThis.fetch;
let verified = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://challenges.cloudflare.com/")) {
    verified++;
    const token = init.body.get("response");
    return Response.json({ success: token === "good" });
  }
  return realFetch(url, init);
};

const env = { ...process.env };
after(async () => {
  globalThis.fetch = realFetch;
  await ml.close();
  await appSql.end();
  await sql.end();
});

const photo = (marker = "") => Buffer.from(`not really a jpeg ${marker}`).toString("base64");
const anAddress = () => `198.18.${randomInt(256)}.${randomInt(1, 255)}`;

function ask(body, ip = anAddress()) {
  return POST(
    new Request("http://localhost/api/identify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

/** What the address has been charged, by budget. */
async function charged(ip) {
  const keys = [`identify-burst:${addressKey(ip)}`, `identify-daily:${addressKey(ip)}`];
  const rows = await sql`select key, count from rate_limits where key = any(${keys})`;
  return Object.fromEntries(rows.map((r) => [r.key.split(":")[0], r.count]));
}

function withEnv(over, fn) {
  return async () => {
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const k of Object.keys(over)) {
        if (env[k] === undefined) delete process.env[k];
        else process.env[k] = env[k];
      }
    }
  };
}

describe("the challenge comes before the model and before any budget", () => {
  const secret = { TURNSTILE_SECRET_KEY: "test-secret", VERCEL_ENV: undefined };

  test("no token is refused 403, charging nothing and asking no model", withEnv(secret, async () => {
    const ip = anAddress();
    const asked = ml.seen.length;
    const res = await ask({ imageBase64: photo(), page: "wildlife" }, ip);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "challenge_failed" });
    assert.equal(ml.seen.length, asked, "the model was asked without a challenge");
    assert.deepEqual(await charged(ip), {}, "a refused request spent the address's budget");
  }));

  test("a token Cloudflare refuses is refused the same way", withEnv(secret, async () => {
    const before = verified;
    const res = await ask({ imageBase64: photo(), page: "wildlife", turnstileToken: "spent" });
    assert.equal(res.status, 403);
    assert.equal(verified, before + 1, "the token was never redeemed");
  }));

  test("a token Cloudflare accepts reaches the model once, and is charged once", withEnv(secret, async () => {
    const ip = anAddress();
    const asked = ml.seen.length;
    const res = await ask({ imageBase64: photo(), page: "wildlife", turnstileToken: "good" }, ip);
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(ml.seen.length, asked + 1);
    assert.deepEqual(await charged(ip), { "identify-burst": 1, "identify-daily": 1 });
  }));

  test("with no secret, as locally and in CI, no token is needed", withEnv({ TURNSTILE_SECRET_KEY: undefined, VERCEL_ENV: undefined }, async () => {
    assert.equal((await ask({ imageBase64: photo(), page: "wildlife" })).status, 200);
  }));

  test("in production a missing secret refuses rather than opening the door", withEnv({ TURNSTILE_SECRET_KEY: undefined, VERCEL_ENV: "production" }, async () => {
    assert.equal((await ask({ imageBase64: photo(), page: "wildlife", turnstileToken: "good" })).status, 403);
  }));

  test("malformed requests are answered before the challenge is redeemed", withEnv(secret, async () => {
    const before = verified;
    for (const body of [{ page: "nowhere", imageBase64: photo() }, { page: "wildlife", imageBase64: "not base64!" }])
      assert.equal((await ask({ ...body, turnstileToken: "good" })).status, 400);
    assert.equal(verified, before, "a token was spent on a request that was never going to be answered");
  }));
});

describe("the budgets stay behind the challenge", () => {
  test("an address's day is forty identifications", async () => {
    const ip = anAddress();
    const key = `identify-daily:${addressKey(ip)}`;
    await sql`
      insert into rate_limits (key, window_start, count)
      values (${key}, to_timestamp(floor(extract(epoch from now()) / 86400) * 86400), 40)`;
    try {
      const res = await ask({ imageBase64: photo(), page: "wildlife" }, ip);
      assert.equal(res.status, 429);
      assert.deepEqual(await res.json(), { error: "rate_limited" });
    } finally {
      await sql`delete from rate_limits where key = any(${[key, `identify-burst:${addressKey(ip)}`]})`;
    }
  });

  test("and the whole site's day is the backstop, whoever asks", async () => {
    const window = sql`to_timestamp(floor(extract(epoch from now()) / 86400) * 86400)`;
    const [was] = await sql`select count from rate_limits where key = 'identify-site' and window_start = ${window}`;
    await sql`
      insert into rate_limits (key, window_start, count) values ('identify-site', ${window}, 1500)
      on conflict (key, window_start) do update set count = 1500`;
    try {
      const asked = ml.seen.length;
      assert.equal((await ask({ imageBase64: photo(), page: "wildlife" })).status, 429);
      assert.equal(ml.seen.length, asked);
    } finally {
      // Put back as it was: on a laptop the database is shared.
      if (was) await sql`update rate_limits set count = ${was.count} where key = 'identify-site' and window_start = ${window}`;
      else await sql`delete from rate_limits where key = 'identify-site' and window_start = ${window}`;
    }
  });
});

const ids = (r) => r.suggestions.map((s) => s.id);

for (const contract of ["1", "2"]) {
  describe(`what the model says, under contract ${contract}`, () => {
    before(() => {
      if (contract === "2") process.env.ML_CONTRACT = "2";
      else delete process.env.ML_CONTRACT;
    });
    after(() => {
      if (env.ML_CONTRACT === undefined) delete process.env.ML_CONTRACT;
      else process.env.ML_CONTRACT = env.ML_CONTRACT;
    });

    test("the wildlife page offers the animals, not the tree, and nothing under 1%", async () => {
      const r = await identifyPhoto(photo(), "wildlife", 5_000);
      assert.equal(r.band, "medium");
      assert.deepEqual(ids(r), [CANDIDATES.native.id, CANDIDATES.invasive.id]);
      assert.equal(r.outsidePage, null);
      assert.deepEqual(r.suggestions.map((s) => s.score), [0.62, 0.21]);
      assert.equal(r.suggestions[0].scientificName, CANDIDATES.native.name);
    });

    test("the invasive page offers the invasive one, and says the best answer looks native", async () => {
      const r = await identifyPhoto(photo(), "invasive", 5_000);
      assert.deepEqual(ids(r), [CANDIDATES.invasive.id]);
      assert.equal(r.outsidePage?.scientificName, CANDIDATES.native.name);
    });

    test("an answer in the low band offers nothing", async () => {
      const r = await identifyPhoto(photo("stub-ml:low"), "wildlife", 5_000);
      assert.equal(r.band, "low");
      assert.deepEqual(r.suggestions, []);
    });

    test("a photo the model cannot open is its refusal, not an outage", async () => {
      await assert.rejects(identifyPhoto(photo("stub-ml:refuse"), "wildlife", 5_000), (e) => e instanceof ModelRefused);
    });

    test("the model is asked in this contract, and never with the invasive page's closed list", async () => {
      const asked = ml.seen.length;
      await identifyPhoto(photo(), "invasive", 5_000);
      const last = ml.seen.at(-1);
      assert.equal(ml.seen.length, asked + 1);
      assert.equal(last.contract, Number(contract));
      assert.equal(last.category, contract === "1" ? "sighting" : null);
    });
  });
}

describe("the running server", () => {
  /** True when the server's model is the stand-in; never send a photo to the real one. */
  async function stubbed(t) {
    if (!(await requireServer(t))) return false;
    if (await isStubMl(SERVER_ML)) return true;
    const why = "ML_ENDPOINT_URL is not test/stub-ml.mjs, so this would ask the real model";
    if (IN_CI) throw new Error(`${why}. CI starts the stand-in before the server.`);
    t.skip(why);
    return false;
  }

  test("asks the model and offers what the page may", async (t) => {
    if (!(await stubbed(t))) return;
    const res = await fetch(`${BASE_URL}/api/identify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": anAddress() },
      body: JSON.stringify({ imageBase64: photo(), page: "wildlife" }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.deepEqual(ids(body), [CANDIDATES.native.id, CANDIDATES.invasive.id]);
  });

  test("answers 422 for a photo the model refuses, so the form can say so", async (t) => {
    if (!(await stubbed(t))) return;
    const res = await fetch(`${BASE_URL}/api/identify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": anAddress() },
      body: JSON.stringify({ imageBase64: photo("stub-ml:refuse"), page: "wildlife" }),
    });
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: "unreadable" });
  });
});
