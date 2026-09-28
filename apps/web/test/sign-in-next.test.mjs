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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  safeNextPath,
  loginPathFor,
  nextFromCookie,
  NEXT_COOKIE_PATH,
} from "../lib/signInNext.ts";
import { sendFailure, verifyFailure } from "../lib/signInErrors.ts";

/** Written to leave the origin outright. */
const LEAVES = [
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
];

/** Written to stay on it, until the dots are resolved. */
const DOT_ESCAPES = [
  "/.//evil.example",
  "/%2e//evil.example",
  "/%2E//evil.example",
  "/..//evil.example",
  "/%2e%2e//evil.example",
  "/.%2E//evil.example",
  "/a/..//evil.example",
  "/a/b/../..//evil.example",
  "/./\\evil.example",
  "/.\\/evil.example",
  "/\t.//evil.example",
  "/.\n//evil.example",
  "/.//evil.example/x?y=1#z",
  "/.//",
];

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
    for (const p of LEAVES) assert.equal(safeNextPath(p), null, `accepted ${JSON.stringify(p)}`);
  });

  test("a path that only leaves once its dot segments are removed is refused", () => {
    // Each of these is on the origin as written, and each came back from the
    // first version of this function as "//evil.example": resolving the dots
    // left an empty first segment, and a browser reads that as a host.
    for (const p of DOT_ESCAPES)
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

/**
 * What every answer must be, whatever the question.
 *
 * The lists above are the tricks someone thought of. These are the properties
 * that make the tricks irrelevant, checked over those lists and over a few
 * thousand paths made from the characters URL parsers treat specially. The
 * dot-segment escape got past the lists; either property below catches it.
 */
describe("whatever it is given, what comes out", () => {
  /** A small seeded PRNG (mulberry32), so a failure reproduces exactly. */
  function random(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const PARTS = [
    "/", "/", "/", "//", "\\", ".", "..", "%2e", "%2E", "%2f", "%5c", "%09",
    "\t", "\n", "\r", " ", "@", ":", "?", "#", "evil.example", "a", "en",
    "login", "auth", "map", "é", "　",
  ];
  function corpus() {
    const next = random(20260928);
    const out = [...LEAVES, ...DOT_ESCAPES];
    for (let i = 0; i < 20000; i++) {
      let s = "/";
      const n = 1 + Math.floor(next() * 8);
      for (let j = 0; j < n; j++) s += PARTS[Math.floor(next() * PARTS.length)];
      out.push(s);
    }
    return out;
  }
  const accepted = corpus()
    .map((raw) => [raw, safeNextPath(raw)])
    .filter(([, out]) => out !== null);

  test("the corpus is not all refused, so the properties are tested", () => {
    assert.ok(accepted.length > 1000, `only ${accepted.length} paths accepted`);
  });

  test("stays on whichever origin it is resolved against", () => {
    for (const base of ["https://preservation-web-one.vercel.app", "http://127.0.0.1:3000"])
      for (const [raw, out] of accepted)
        assert.equal(
          new URL(out, base).origin,
          new URL(base).origin,
          `${JSON.stringify(raw)} became ${JSON.stringify(out)}`,
        );
  });

  test("is a path: one leading slash, and nothing a browser would read as a slash", () => {
    for (const [raw, out] of accepted) {
      const why = `${JSON.stringify(raw)} became ${JSON.stringify(out)}`;
      assert.ok(out.startsWith("/") && !out.startsWith("//"), why);
      // Only the path: a backslash after ? or # is data, and the serialiser
      // rightly leaves it there.
      assert.doesNotMatch(out.split(/[?#]/)[0], /\\/, why);
      // Anywhere: the callback puts this in a Location header.
      assert.doesNotMatch(out, /[\t\n\r]/, why);
    }
  });

  test("is its own answer: checking it again changes nothing", () => {
    // The callback checks the cookie's copy a second time. An answer that the
    // same rule would refuse is one the first check should never have given.
    for (const [raw, out] of accepted)
      assert.equal(safeNextPath(out), out, `${JSON.stringify(raw)} became ${JSON.stringify(out)}`);
  });
});

describe("the cookie that carries it through the email", () => {
  test("round-trips an encoded path", () => {
    assert.equal(nextFromCookie(encodeURIComponent("/en/map?x=1")), "/en/map?x=1");
  });

  test("is held to the same rule as the query string", () => {
    for (const p of [...LEAVES, ...DOT_ESCAPES])
      assert.equal(nextFromCookie(encodeURIComponent(p)), null, JSON.stringify(p));
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

  test("an address Supabase declines is not told that trying again will help", () => {
    // 400 and 422 are what a malformed address gets. Asking again is declined
    // again.
    for (const s of [400, 403, 422]) assert.equal(sendFailure(s), "refused", String(s));
    assert.equal(sendFailure(400, "email_address_invalid"), "refused");
  });

  test("an address outside the project team is told sign-in is not open to it yet", () => {
    // What every member of the public gets until the project has a mail
    // server of its own: not their mistake, and not fixed by another address.
    assert.equal(sendFailure(400, "email_address_not_authorized"), "notOpen");
    // The code only counts alongside a refusal; an outage is still an outage.
    assert.equal(sendFailure(500, "email_address_not_authorized"), "failed");
  });

  test("no answer, a server fault or a timeout is worth trying again", () => {
    for (const s of [0, undefined, 408, 500, 502, 503])
      assert.equal(sendFailure(s), "failed", String(s));
  });

  test("only the retryable send failure says to try again", () => {
    // Pinned in the words, not just the key: "failed" promises that retrying
    // can work, and the refusals must not, in either language.
    const read = (f) =>
      JSON.parse(readFileSync(join(import.meta.dirname, "..", "messages", f), "utf8")).login;
    const en = read("en.json");
    const zh = read("zh-TW.json");
    assert.match(en.failed, /try again/i);
    assert.match(zh.failed, /再試/);
    for (const key of ["refused", "notOpen"]) {
      assert.doesNotMatch(en[key], /try again|shortly|later/i, key);
      assert.doesNotMatch(zh[key], /再試|稍後/, key);
    }
    // Reporting needs no account; someone turned away from signing in is told so.
    assert.match(en.notOpen, /report/i);
    assert.match(zh.notOpen, /通報/);
  });
});
