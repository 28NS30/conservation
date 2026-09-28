import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL } from "./helpers.mjs";

/**
 * The magic-link callback has to be reachable.
 *
 * It lives at app/auth/callback, outside [locale], and Supabase sends people to
 * exactly that URL. The locale proxy rewrote it to /zh-TW/auth/callback, which
 * does not exist, so every sign-in link in production landed on a 404. Nothing
 * failed and nothing logged: the site has no users yet, so nobody had tried.
 */
const opts = { redirect: "manual" };
const location = (res) => res.headers.get("location") ?? "";

describe("sign-in callback", () => {
  test("is answered by its handler, not by the locale router", async () => {
    const res = await fetch(`${BASE_URL}/auth/callback`, opts);
    assert.notEqual(res.status, 404, "the callback must not 404");
    assert.equal(res.status, 307);
    assert.match(
      location(res),
      /\/login\?error=missing_code$/,
      "with no code it sends the reader back to sign in, saying why",
    );
  });

  test("a bad code is refused by the exchange, not by routing", async () => {
    const res = await fetch(`${BASE_URL}/auth/callback?code=not-a-real-code`, opts);
    assert.equal(res.status, 307);
    assert.match(location(res), /error=exchange_failed/);
  });

  test("the login page sends links to the path that works", () => {
    // If either end moves, the two must move together.
    const form = readFileSync(
      join(import.meta.dirname, "..", "components", "auth", "SignInForm.tsx"),
      "utf8",
    );
    assert.match(form, /withBase\("\/auth\/callback"\)/);
    const proxy = readFileSync(join(import.meta.dirname, "..", "proxy.ts"), "utf8");
    assert.match(proxy, /\(\?!api\|auth\//, "the proxy matcher must exclude auth/");
  });
});

/**
 * Signing in returns you to where you were, and only ever to this site.
 *
 * The return path reaches the callback two ways — `?next=` and the short-lived
 * cookie the login page sets before sending the email — and both are strings
 * anyone can write. `/\evil.example` used to pass the callback's check.
 */
describe("the return path through the callback", () => {
  test("a failed link goes back to the form in the reader's language, still carrying it", async () => {
    const res = await fetch(`${BASE_URL}/auth/callback?next=${encodeURIComponent("/en/map")}`, opts);
    const to = new URL(location(res), BASE_URL);
    assert.equal(to.pathname, "/en/login");
    assert.equal(to.searchParams.get("error"), "missing_code");
    assert.equal(to.searchParams.get("next"), "/en/map");
  });

  test("the cookie carries it when the URL cannot", async () => {
    const res = await fetch(`${BASE_URL}/auth/callback`, {
      ...opts,
      headers: { cookie: `sign_in_next=${encodeURIComponent("/en/species?q=frog")}` },
    });
    const to = new URL(location(res), BASE_URL);
    assert.equal(to.pathname, "/en/login");
    assert.equal(to.searchParams.get("next"), "/en/species?q=frog");
  });

  test("an off-site path is dropped, from either source", async () => {
    for (const evil of ["/\\evil.example", "//evil.example", "https://evil.example"]) {
      const viaQuery = await fetch(
        `${BASE_URL}/auth/callback?next=${encodeURIComponent(evil)}`,
        opts,
      );
      const viaCookie = await fetch(`${BASE_URL}/auth/callback`, {
        ...opts,
        headers: { cookie: `sign_in_next=${encodeURIComponent(evil)}` },
      });
      for (const res of [viaQuery, viaCookie]) {
        assert.doesNotMatch(location(res), /evil/, `${evil} survived into ${location(res)}`);
        assert.match(location(res), /\/login\?error=missing_code$/);
      }
    }
  });
});

/** Whether the local (or CI) Supabase would let Google sign-in start. */
async function googleIsOn() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return false;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
      signal: AbortSignal.timeout(2000),
    });
    return res.ok && (await res.json())?.external?.google === true;
  } catch {
    return false;
  }
}

describe("the sign-in page", () => {
  test("has a title of its own in each language", async () => {
    const zh = await fetch(`${BASE_URL}/login`).then((r) => r.text());
    const en = await fetch(`${BASE_URL}/en/login`).then((r) => r.text());
    assert.match(zh, /<title>登入 · /);
    assert.match(en, /<title>Sign in · /);
  });

  test("says both ways the email can be used", async () => {
    // The page cannot know which the email carries — that is Supabase's
    // template — so the words that appear after sending must cover both. They
    // are in the page's messages from the first load.
    const en = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "messages", "en.json"), "utf8"),
    );
    assert.match(en.login.codeHelp, /6-digit code/);
    assert.match(en.login.codeHelp, /link/);
    assert.doesNotMatch(en.login.explain, /only gives you your own history/);
  });

  test("offers Google exactly when the Supabase project has it switched on", async () => {
    // Looks for the rendered button, not its words: the whole catalogue is
    // serialised into every page for the client, so the label is always there.
    const on = await googleIsOn();
    for (const path of ["/login", "/en/login"]) {
      const html = await fetch(`${BASE_URL}${path}`).then((r) => r.text());
      assert.equal(
        html.includes('data-sign-in="google"'),
        on,
        on ? `${path} hides Google though it is on` : `${path} offers Google though it is off`,
      );
    }
  });

  test("never turns an off-site return path into a link or a form target", async () => {
    // The raw query string does appear in the page — Next serialises the URL
    // for its router — but only as data; no attribute may carry it.
    const html = await fetch(
      `${BASE_URL}/en/login?next=${encodeURIComponent("//evil.example/x")}`,
    ).then((r) => r.text());
    assert.doesNotMatch(html, /="[^"]*evil\.example/);
  });
});

/**
 * The proxy renews sessions now. Whatever it finds in the cookie, the page
 * still has to render: a stale, forged or garbled session is a signed-out
 * visitor, not an error.
 */
describe("a session cookie never breaks a page", () => {
  const name = () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return url ? `sb-${new URL(url).hostname.split(".")[0]}-auth-token` : null;
  };
  const encode = (s) => `base64-${Buffer.from(JSON.stringify(s)).toString("base64url")}`;
  const now = () => Math.floor(Date.now() / 1000);

  test("garbage in the cookie renders the page signed out", async () => {
    if (!name()) return;
    for (const value of ["garbage", "base64-!!!", encode({ nope: true })]) {
      const res = await fetch(`${BASE_URL}/en/about`, {
        headers: { cookie: `${name()}=${value}` },
      });
      assert.equal(res.status, 200, value);
    }
  });

  test("an expired session with a refresh token Supabase refuses is cleared", async (t) => {
    if (!name()) return t.skip("no Supabase configured");
    const up = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(2000),
    }).then((r) => r.ok, () => false);
    if (!up) return t.skip("no Supabase auth running to refuse it");
    const res = await fetch(`${BASE_URL}/en/about`, {
      headers: {
        cookie: `${name()}=${encode({
          access_token: "x",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: now() - 60,
          refresh_token: "not-a-real-refresh-token",
          user: { id: "00000000-0000-4000-8000-000000000000" },
        })}`,
      },
    });
    assert.equal(res.status, 200);
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith(`${name()}=`));
    assert.match(cleared ?? "", /Max-Age=0/i, "the dead session must be cleared, or every request retries it");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  });
});
