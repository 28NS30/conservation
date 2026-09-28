/**
 * The proxy renews an expiring session, and hands the renewal to both the page
 * and the browser.
 *
 * Nothing did this before. Server Components cannot set cookies, so the
 * header's getUser() spent the single-use refresh token and threw the new one
 * away; about an hour after signing in, the next page arrived with a spent
 * token and the person was silently signed out.
 *
 * Run against a stand-in for Supabase's token endpoint rather than a real
 * project, so it is exact about what was asked for and runs anywhere.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
// next has no "exports" map, so Node needs the file name.
import { NextRequest, NextResponse } from "next/server.js";
import {
  applyRefreshed,
  authCookieName,
  hasSessionCookie,
  refreshSession,
} from "../lib/supabase/proxy.ts";

/** What the stand-in does with the next refresh: "ok", "reject" or "hang". */
let mode = "ok";
let calls = 0;
let server;
let base;

const now = () => Math.floor(Date.now() / 1000);
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", email: "a@example.com" };
const session = (at, rt, expiresAt) => ({
  access_token: at,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: expiresAt,
  refresh_token: rt,
  user,
});
/** How @supabase/ssr stores a session: base64url JSON behind a prefix. */
const encode = (s) => `base64-${Buffer.from(JSON.stringify(s)).toString("base64url")}`;
const decode = (v) => JSON.parse(Buffer.from(v.replace(/^base64-/, ""), "base64url").toString());

before(async () => {
  server = createServer((req, res) => {
    if (req.method === "POST" && req.url.startsWith("/auth/v1/token?grant_type=refresh_token")) {
      calls++;
      if (mode === "hang") return; // never answers
      res.setHeader("content-type", "application/json");
      if (mode === "reject") {
        res.statusCode = 400;
        return res.end(
          JSON.stringify({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" }),
        );
      }
      return res.end(JSON.stringify(session("new-access", "new-refresh", now() + 3600)));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.NEXT_PUBLIC_SUPABASE_URL = base;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const cookieName = () => authCookieName(base);
function request(cookies = {}) {
  const header = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`${base.replace("127.0.0.1", "localhost")}/map`, {
    headers: header ? { cookie: header } : {},
  });
}

describe("which requests pay for it", () => {
  test("the cookie name follows supabase-js", () => {
    assert.equal(authCookieName("https://abcdefgh.supabase.co"), "sb-abcdefgh-auth-token");
    assert.equal(authCookieName("not a url"), null);
  });

  test("a session cookie counts in one piece or in chunks; the PKCE verifier does not", () => {
    const n = "sb-x-auth-token";
    assert.equal(hasSessionCookie([n], n), true);
    assert.equal(hasSessionCookie([`${n}.0`, `${n}.1`], n), true);
    assert.equal(hasSessionCookie([`${n}-code-verifier`], n), false);
    assert.equal(hasSessionCookie(["NEXT_LOCALE", "sign_in_next"], n), false);
  });

  test("no session cookie: nothing is built and nothing is fetched", async () => {
    calls = 0;
    assert.equal(await refreshSession(request({ NEXT_LOCALE: "en" })), null);
    assert.equal(calls, 0);
  });

  test("a session with time left: nothing is fetched and nothing is set", async () => {
    calls = 0;
    const fresh = encode(session("still-good", "rt", now() + 1800));
    assert.equal(await refreshSession(request({ [cookieName()]: fresh })), null);
    assert.equal(calls, 0);
  });
});

describe("an expired session", () => {
  test("is renewed once, and the page sees the renewal", async () => {
    mode = "ok";
    calls = 0;
    const req = request({ [cookieName()]: encode(session("old-access", "old-refresh", now() - 60)) });
    const out = await refreshSession(req);
    assert.equal(calls, 1);
    assert.ok(out, "a renewal must be returned for the response");

    // The page: the request's own cookies now hold the new session, and the
    // Cookie header that next-intl forwards says the same.
    const seen = decode(req.cookies.get(cookieName()).value);
    assert.equal(seen.refresh_token, "new-refresh");
    const forwarded = /(?:^|; )sb-127-auth-token=([^;]+)/.exec(req.headers.get("cookie"))?.[1];
    assert.equal(decode(forwarded).refresh_token, "new-refresh");

    // The browser: Set-Cookie on whatever response routing produced, and the
    // headers that keep a CDN from serving one person's session to another.
    const res = applyRefreshed(NextResponse.next(), out);
    const set = res.headers.getSetCookie().find((c) => c.startsWith(`${cookieName()}=`));
    assert.ok(set, "the renewed session must be sent to the browser");
    assert.equal(decode(set.split(";")[0].split("=").slice(1).join("=")).access_token, "new-access");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  });

  test("a refused renewal clears the dead cookie, so later requests skip the work", async () => {
    mode = "reject";
    const req = request({ [cookieName()]: encode(session("old", "revoked", now() - 60)) });
    const out = await refreshSession(req);
    assert.ok(out);
    assert.equal(req.cookies.get(cookieName()), undefined, "the page must not see it");
    const res = applyRefreshed(NextResponse.next(), out);
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith(`${cookieName()}=`));
    assert.match(cleared ?? "", /Max-Age=0/i);
  });

  test("an unresponsive Supabase is waited on only until the deadline", async () => {
    mode = "hang";
    const req = request({ [cookieName()]: encode(session("old", "rt", now() - 60)) });
    const started = Date.now();
    assert.equal(await refreshSession(req, { deadlineMs: 300 }), null);
    assert.ok(Date.now() - started < 2000, `held the request for ${Date.now() - started}ms`);
    // The page renders with what it came with.
    assert.equal(decode(req.cookies.get(cookieName()).value).refresh_token, "rt");
  });

  test("an unreachable Supabase never throws into the proxy", async () => {
    const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Same cookie name, nothing listening.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
    try {
      const req = request({ "sb-127-auth-token": encode(session("old", "rt", now() - 60)) });
      assert.equal(await refreshSession(req, { deadlineMs: 500 }), null);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
    }
  });
});

describe("previews", () => {
  test("with no Supabase configured, a stray cookie changes nothing", async () => {
    const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      const req = request({ "sb-127-auth-token": "whatever" });
      assert.equal(await refreshSession(req), null);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
    }
  });
});
