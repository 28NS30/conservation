import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BASE_URL } from "./helpers.mjs";
import { STUB_NAME } from "./stub-gotrue.mjs";

/**
 * Return paths that must never take anyone off the site. The last six are on
 * this origin as written and leave it only once their dot segments are
 * resolved — the first version of safeNextPath passed every one of them on as
 * "//evil.example".
 */
const OFF_SITE = [
  "/\\evil.example",
  "//evil.example",
  "//evil.example/x",
  "https://evil.example",
  "/.//evil.example",
  "/%2e//evil.example",
  "/..//evil.example",
  "/a/..//evil.example",
  "/./\\evil.example",
  "/\t.//evil.example",
];

const SITE = new URL(BASE_URL).origin;

/** Where a Location header sends a browser that asked BASE_URL. */
const resolved = (res) => new URL(res.headers.get("location") ?? "", BASE_URL);

/** How @supabase/ssr stores a session: base64url JSON behind a prefix. */
const encode = (s) => `base64-${Buffer.from(JSON.stringify(s)).toString("base64url")}`;
const decode = (v) => JSON.parse(Buffer.from(v.replace(/^base64-/, ""), "base64url").toString());
const now = () => Math.floor(Date.now() / 1000);
const authCookie = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url ? `sb-${new URL(url).hostname.split(".")[0]}-auth-token` : null;
};

/**
 * The props the page handed a client component, read from the RSC payload.
 *
 * A client component's props never appear as HTML attributes; they travel in
 * the flight data Next streams into the page, and that is what the component
 * acts on. So a test that looked for the return path in attributes (as this
 * file's first did) could not have seen it go wrong.
 */
function flight(html) {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g))
    out += JSON.parse(m[1]);
  return out;
}

/** The `next` the sign-in form was given: where it sends someone after the code. */
function formNext(html) {
  // Anchored on the props that follow it: the message catalogue, serialised
  // into the same payload, has a "next" key of its own ("Next").
  const m = /\{"next":("(?:[^"\\]|\\.)*"),"google":(?:true|false),"callbackError":(?:true|false)\}/.exec(
    flight(html),
  );
  return m ? JSON.parse(m[1]) : undefined;
}

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
    // Without a code the callback sends the reader back to the form, and the
    // return path it chose rides along in that URL. With a code it goes to the
    // return path itself — the same value — so this is where it can be seen.
    for (const evil of OFF_SITE) {
      const viaQuery = await fetch(
        `${BASE_URL}/auth/callback?next=${encodeURIComponent(evil)}`,
        opts,
      );
      const viaCookie = await fetch(`${BASE_URL}/auth/callback`, {
        ...opts,
        headers: { cookie: `sign_in_next=${encodeURIComponent(evil)}` },
      });
      for (const res of [viaQuery, viaCookie]) {
        const why = `${JSON.stringify(evil)} became ${location(res)}`;
        assert.equal(res.status, 307, why);
        assert.ok(!location(res).startsWith("//"), why);
        assert.equal(resolved(res).origin, SITE, why);
        assert.doesNotMatch(location(res), /evil/, why);
        assert.match(location(res), /\/login\?error=missing_code$/, why);
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

  test("hands the form the page to return to, in the reader's language", async () => {
    // The control for the test below: if the props could not be found, every
    // off-site case would pass by finding nothing.
    const page = (path) => fetch(`${BASE_URL}${path}`).then((r) => r.text());
    assert.equal(formNext(await page(`/en/login?next=${encodeURIComponent("/en/map?x=1")}`)), "/en/map?x=1");
    assert.equal(formNext(await page("/en/login")), "/en");
    assert.equal(formNext(await page("/login")), "/");
  });

  test("never hands the form a return path off the site", async () => {
    // The form sends the reader there with location.replace() once the code is
    // right, so this prop is the sink, not anything in the HTML.
    for (const evil of OFF_SITE) {
      const html = await fetch(`${BASE_URL}/en/login?next=${encodeURIComponent(evil)}`).then((r) =>
        r.text(),
      );
      assert.equal(formNext(html), "/en", JSON.stringify(evil));
      // The raw query string does appear in the page — Next serialises the
      // URL for its router — but only as data; no attribute may carry it.
      assert.doesNotMatch(html, /="[^"]*evil\.example/, JSON.stringify(evil));
    }
  });
});

describe("the header's way in", () => {
  test("a signed-out page links to sign-in, returning to that page", async () => {
    for (const [path, href] of [
      ["/species", "/login?next=%2Fspecies"],
      ["/en/stats", "/en/login?next=%2Fen%2Fstats"],
    ]) {
      const html = await fetch(`${BASE_URL}${path}`).then((r) => r.text());
      assert.ok(html.includes(`href="${href}"`), `${path} has no ${href}`);
    }
  });
});

/**
 * The proxy renews sessions now. Whatever it finds in the cookie, the page
 * still has to render: a stale, forged or garbled session is a signed-out
 * visitor, not an error.
 */
describe("a session cookie never breaks a page", () => {
  const name = authCookie;

  test("garbage in the cookie renders the page signed out", async () => {
    if (!name()) return;
    for (const value of ["garbage", "base64-!!!", encode({ nope: true })]) {
      const res = await fetch(`${BASE_URL}/en/about`, {
        headers: { cookie: `${name()}=${value}` },
      });
      assert.equal(res.status, 200, value);
      assert.match(await res.text(), /href="\/en\/login\?next=/);
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

/**
 * Signed in, through the built app, against a real Supabase Auth.
 *
 * Which Supabase Auth: the local stack when run locally, and in CI the
 * stand-in at test/stub-gotrue.mjs, which CI starts where the app expects
 * Supabase to be. These make a throwaway user through the admin API and
 * delete it afterwards, so they refuse to run against anything that is not
 * this machine, whatever the environment says.
 */
describe("signed in", () => {
  const auth = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  /** null when usable; otherwise why these are skipped. */
  let unusable = "not checked yet";
  /** Whether the Supabase Auth answering is the stand-in. */
  let stub = false;
  const made = [];

  before(async () => {
    if (!auth.url || !auth.service) return void (unusable = "no Supabase configured");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(auth.url).hostname))
      return void (unusable = `${new URL(auth.url).origin} is not this machine`);
    const health = await fetch(`${auth.url}/auth/v1/health`, {
      headers: { apikey: auth.anon },
      signal: AbortSignal.timeout(2000),
    }).then((r) => (r.ok ? r.json() : null), () => null);
    if (!health) return void (unusable = "no Supabase auth running");
    stub = health.name === STUB_NAME;
    unusable = null;
  });

  after(async () => {
    for (const id of made) await admin("DELETE", `/admin/users/${id}`).catch(() => {});
  });

  async function admin(method, path, body) {
    const res = await fetch(`${auth.url}/auth/v1${path}`, {
      method,
      headers: {
        apikey: auth.service,
        authorization: `Bearer ${auth.service}`,
        "content-type": "application/json",
      },
      body: body && JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`admin ${method} ${path}: ${res.status}`);
    return res.json();
  }

  /**
   * A cookie holding a fresh session for a new throwaway user, stored the way
   * @supabase/ssr stores one. `expired` backdates only the expiry the client
   * reads, which is what makes the proxy renew it.
   */
  async function signedIn({ prefix = "sign-in-test", expired = false } = {}) {
    const email = `${prefix}-${randomUUID()}@example.com`;
    const password = randomUUID();
    made.push((await admin("POST", "/admin/users", { email, password, email_confirm: true })).id);
    const res = await fetch(`${auth.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: auth.anon, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 200, "could not sign the test user in");
    const s = await res.json();
    const stored = {
      access_token: s.access_token,
      token_type: "bearer",
      expires_in: s.expires_in,
      expires_at: expired ? now() - 60 : s.expires_at,
      refresh_token: s.refresh_token,
      user: { id: s.user.id },
    };
    return { cookie: `${authCookie()}=${encode(stored)}`, refreshToken: s.refresh_token };
  }

  const signedInHeader = /href="\/en\/me"/;
  const signedOutHeader = /href="\/en\/login\?next=/;

  test("the header knows who is signed in", async (t) => {
    // The control for everything below: a session these tests make is one the
    // app accepts.
    if (unusable) return t.skip(unusable);
    const { cookie } = await signedIn();
    const html = await fetch(`${BASE_URL}/en/about`, { headers: { cookie } }).then((r) => r.text());
    assert.match(html, signedInHeader);
    assert.doesNotMatch(html, signedOutHeader);
  });

  test("/login sends someone already signed in on to where they were going", async (t) => {
    if (unusable) return t.skip(unusable);
    const { cookie } = await signedIn();
    const res = await fetch(`${BASE_URL}/en/login?next=${encodeURIComponent("/en/map?x=1")}`, {
      ...opts,
      headers: { cookie },
    });
    assert.equal(res.status, 307);
    assert.equal(resolved(res).href, `${SITE}/en/map?x=1`);
  });

  test("…and never off the site, without a click", async (t) => {
    // The one place the dot-segment escape needed nothing from its victim but
    // opening a link while signed in: the page redirected before rendering.
    if (unusable) return t.skip(unusable);
    const { cookie } = await signedIn();
    for (const evil of OFF_SITE) {
      const res = await fetch(`${BASE_URL}/en/login?next=${encodeURIComponent(evil)}`, {
        ...opts,
        headers: { cookie },
      });
      const why = `${JSON.stringify(evil)} became ${location(res)}`;
      assert.equal(res.status, 307, why);
      assert.ok(!location(res).startsWith("//"), why);
      assert.equal(resolved(res).origin, SITE, why);
      assert.equal(resolved(res).pathname, "/en", why);
    }
  });

  test("an expired session is renewed on the way in, and the page renders with the renewal", async (t) => {
    // The proxy's renewal has to reach two places: the browser (Set-Cookie on
    // whatever response routing produced) and this render (the request's
    // cookies, which next-intl forwards). The unit test drives a hand-built
    // request; this is the built app under `next start`.
    if (unusable) return t.skip(unusable);
    const { cookie, refreshToken } = await signedIn({ expired: true });
    const res = await fetch(`${BASE_URL}/en/about`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const set = res.headers.getSetCookie().find((c) => c.startsWith(`${authCookie()}=`));
    assert.ok(set, "the renewed session must be sent to the browser");
    const renewed = decode(set.split(";")[0].slice(authCookie().length + 1));
    assert.notEqual(renewed.refresh_token, refreshToken, "the refresh token was not rotated");
    assert.ok(renewed.expires_at > now(), "the new session is already expired");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.match(await res.text(), signedInHeader, "the page rendered without the renewal");
  });

  test("a Supabase that stops answering costs a page seconds, not the page", async (t) => {
    // Only the stand-in can be told to stop answering (for a user whose
    // address begins "hang-"). Before the page had a deadline of its own,
    // this request waited for as long as the socket did.
    if (unusable) return t.skip(unusable);
    if (!stub) return t.skip("needs the stand-in, which can be made to hang");
    const { cookie } = await signedIn({ prefix: "hang" });
    const started = Date.now();
    const res = await fetch(`${BASE_URL}/en/about`, {
      headers: { cookie },
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), signedOutHeader, "with no answer, nobody is signed in");
    assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started}ms`);
  });
});
