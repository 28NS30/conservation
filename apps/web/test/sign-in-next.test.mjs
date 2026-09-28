/**
 * Where signing in sends you afterwards.
 *
 * The return path arrives from the outside — a query string anyone can write,
 * a cookie anyone can set — and the callback turns it into a redirect under
 * this site's name. So the one rule is: this site's own paths, nothing else.
 *
 * The callback's old check was `startsWith("/") && !startsWith("//")`, which
 * `/\evil.example` walks straight past: browsers read a backslash in a URL as a
 * slash. Every case below that is refused was chosen because some browser, or
 * the URL parser, turns it into another origin.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  safeNextPath,
  loginPathFor,
  nextFromCookie,
  NEXT_COOKIE_PATH,
} from "../lib/signInNext.ts";
import { sendFailure, verifyFailure } from "../lib/signInErrors.ts";

describe("safeNextPath keeps people on this site", () => {
  test("ordinary paths pass through, query and hash included", () => {
    for (const p of [
      "/",
      "/map",
      "/en/map",
      "/species/28758-duttaphrynus-melanostictus",
      "/reports?taxon=123&page=2",
      "/en/species?q=%E7%9F%B3%E8%99%8E",
      "/about#contact",
    ])
      assert.equal(safeNextPath(p), p);
  });

  test("dot segments are resolved, not passed on", () => {
    assert.equal(safeNextPath("/species/../map"), "/map");
  });

  test("anything that leaves the origin is refused", () => {
    for (const p of [
      "//evil.example",
      "//evil.example/path",
      "/\\evil.example",
      "/\\/evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "https://evil.example/",
      "http:evil.example",
      "javascript:alert(1)",
      "evil.example",
      "",
    ])
      assert.equal(safeNextPath(p), null, `accepted ${JSON.stringify(p)}`);
  });

  test("only strings are considered", () => {
    for (const v of [undefined, null, 42, ["/map"], { href: "/map" }])
      assert.equal(safeNextPath(v), null);
  });

  test("an absurdly long path is refused rather than echoed into a header", () => {
    assert.equal(safeNextPath(`/${"a".repeat(3000)}`), null);
  });

  test("the sign-in machinery itself is never a destination", () => {
    // Back to the form after signing in reads as a failure; back to the
    // callback would try to spend a code twice.
    for (const p of [
      "/login",
      "/login?next=/map",
      "/en/login",
      "/zh-TW/login",
      "/auth/callback",
      "/auth/callback?code=x",
      "/auth",
    ])
      assert.equal(safeNextPath(p), null, `accepted ${p}`);
    // …but a page that merely has "login" in it is fine.
    assert.equal(safeNextPath("/species/loginus"), "/species/loginus");
  });
});

describe("the cookie that carries it through the email", () => {
  test("round-trips an encoded path", () => {
    assert.equal(nextFromCookie(encodeURIComponent("/en/map?x=1")), "/en/map?x=1");
  });

  test("is held to the same rule as the query string", () => {
    assert.equal(nextFromCookie(encodeURIComponent("/\\evil.example")), null);
    assert.equal(nextFromCookie(encodeURIComponent("//evil.example")), null);
  });

  test("tolerates a missing or mangled value", () => {
    assert.equal(nextFromCookie(undefined), null);
    assert.equal(nextFromCookie(""), null);
    assert.equal(nextFromCookie("%E0%A4%A"), null);
  });

  test("is only ever sent to the callback", () => {
    assert.equal(NEXT_COOKIE_PATH, "/auth/callback");
  });
});

describe("a failed link returns you to the form in your language", () => {
  test("English return paths get the English form", () => {
    for (const p of ["/en", "/en/", "/en/map", "/en?x=1", "/en#top"])
      assert.equal(loginPathFor(p), "/en/login", p);
  });

  test("everything else gets the default, unprefixed form", () => {
    for (const p of [null, "/", "/map", "/entries", "/english"])
      assert.equal(loginPathFor(p), "/login", String(p));
  });
});

describe("what each failure tells the reader", () => {
  test("rate limiting says wait, whichever step hit it", () => {
    assert.equal(sendFailure(429), "tooMany");
    assert.equal(verifyFailure(429), "tooMany");
  });

  test("Supabase refusing the code means the code is no good", () => {
    // 403 otp_expired is what it says for wrong and expired codes alike.
    for (const s of [400, 401, 403, 422]) assert.equal(verifyFailure(s), "wrongCode");
  });

  test("no answer, or a server fault, is not blamed on the code", () => {
    // supabase-js reports a request that never got an answer as status 0.
    for (const s of [0, undefined, 500, 502, 503])
      assert.equal(verifyFailure(s), "verifyFailed", String(s));
  });

  test("sending fails generically otherwise", () => {
    for (const s of [0, undefined, 400, 500]) assert.equal(sendFailure(s), "failed");
  });
});
