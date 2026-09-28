/**
 * "Continue with Google" appears only when Google sign-in can actually work.
 *
 * The provider is switched on or off in the Supabase dashboard, which the code
 * cannot see, so the login page asks the project's public settings endpoint.
 * A button shown while the provider is off sends people to a bare Supabase
 * error page; these pin that every doubt — off, missing, unreachable, slow,
 * garbled — resolves to no button, and that the answer is cached so the check
 * is not a round trip on every sign-in page.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createGoogleCheck, googleEnabledIn } from "../lib/authProviders.ts";

/** A Supabase /auth/v1/settings reply, trimmed to what matters. */
const settings = (google) => ({
  external: { email: true, github: false, google },
  disable_signup: false,
});

/** A fake fetch that records calls and answers with whatever `reply` returns. */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return reply(url, init);
  };
  fn.calls = calls;
  return fn;
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("reading the settings", () => {
  test("only an explicit true turns the button on", () => {
    assert.equal(googleEnabledIn(settings(true)), true);
    for (const v of [false, "true", 1, null, undefined])
      assert.equal(googleEnabledIn(settings(v)), false, String(v));
  });

  test("an unexpected shape is a no", () => {
    for (const body of [null, "yes", [], {}, { external: null }, { google: true }])
      assert.equal(googleEnabledIn(body), false, JSON.stringify(body));
  });
});

describe("asking Supabase", () => {
  test("asks the project's own settings endpoint, with the public key", async () => {
    const f = fakeFetch(() => json(settings(true)));
    const check = createGoogleCheck({ url: "https://abc.supabase.co/", anonKey: "anon", fetch: f });
    assert.equal(await check(), true);
    assert.equal(f.calls[0].url, "https://abc.supabase.co/auth/v1/settings");
    assert.equal(f.calls[0].init.headers.apikey, "anon");
  });

  test("provider off: no button", async () => {
    const check = createGoogleCheck({ url: "https://x", fetch: fakeFetch(() => json(settings(false))) });
    assert.equal(await check(), false);
  });

  test("no Supabase configured (a preview): no button, and nothing fetched", async () => {
    const f = fakeFetch(() => json(settings(true)));
    const check = createGoogleCheck({ url: undefined, fetch: f });
    assert.equal(await check(), false);
    assert.equal(f.calls.length, 0);
  });

  test("an error status: no button", async () => {
    for (const status of [401, 404, 500, 503]) {
      const check = createGoogleCheck({ url: "https://x", fetch: fakeFetch(() => json(settings(true), status)) });
      assert.equal(await check(), false, String(status));
    }
  });

  test("unreachable: no button, and no exception reaches the page", async () => {
    const check = createGoogleCheck({
      url: "https://x",
      fetch: fakeFetch(() => {
        throw new TypeError("fetch failed");
      }),
    });
    assert.equal(await check(), false);
  });

  test("not JSON: no button", async () => {
    const check = createGoogleCheck({
      url: "https://x",
      fetch: fakeFetch(() => new Response("<html>gateway</html>", { status: 200 })),
    });
    assert.equal(await check(), false);
  });

  test("too slow: gives up at the timeout rather than holding the page", async () => {
    const f = fakeFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
    );
    const check = createGoogleCheck({ url: "https://x", fetch: f, timeoutMs: 50 });
    // AbortSignal.timeout's timer does not hold Node's event loop open. In the
    // server something always does; here nothing else would, and Node 22 ends
    // the run with the promise still pending before the timeout can fire.
    const hold = setInterval(() => {}, 1000);
    try {
      const started = Date.now();
      assert.equal(await check(), false);
      assert.ok(Date.now() - started < 1000, "the timeout must actually cut the request off");
    } finally {
      clearInterval(hold);
    }
  });
});

describe("caching", () => {
  test("a definite answer is reused until it goes stale", async () => {
    let now = 0;
    let google = false;
    const f = fakeFetch(() => json(settings(google)));
    const check = createGoogleCheck({ url: "https://x", fetch: f, now: () => now, ttlMs: 1000 });

    assert.equal(await check(), false);
    google = true; // the owner switches it on
    now = 999;
    assert.equal(await check(), false, "still the cached answer");
    assert.equal(f.calls.length, 1);
    now = 1000;
    assert.equal(await check(), true, "picked up once stale, with no deploy");
    assert.equal(f.calls.length, 2);
  });

  test("a failure is retried sooner than a success", async () => {
    let now = 0;
    let up = false;
    const f = fakeFetch(() => {
      if (!up) throw new TypeError("fetch failed");
      return json(settings(true));
    });
    const check = createGoogleCheck({
      url: "https://x",
      fetch: f,
      now: () => now,
      ttlMs: 60_000,
      failureTtlMs: 100,
    });
    assert.equal(await check(), false);
    up = true;
    now = 50;
    assert.equal(await check(), false, "an outage is not re-asked on every render");
    now = 100;
    assert.equal(await check(), true, "but it is not remembered for the full five minutes either");
  });

  test("simultaneous renders share one request", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const f = fakeFetch(async () => {
      await gate;
      return json(settings(true));
    });
    const check = createGoogleCheck({ url: "https://x", fetch: f });
    const answers = Promise.all([check(), check(), check()]);
    release();
    assert.deepEqual(await answers, [true, true, true]);
    assert.equal(f.calls.length, 1);
  });
});
