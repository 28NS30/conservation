/**
 * The four response headers the site was not sending, and the one that would
 * have broken the product if written carelessly.
 *
 * HSTS was already served — that is Vercel's platform default rather than
 * anything in this repo — so these four were the real gap. None of them is
 * interesting on its own. `Permissions-Policy` is, because the obvious version
 * of it silently disables the two capabilities the report flow depends on:
 *
 *   - `navigator.geolocation.getCurrentPosition` in `LocationPicker` IS governed
 *     by this header. Denying geolocation removes "use my location", which is
 *     both the fastest path through the form and the only one that produces an
 *     accurate coordinate instead of a dragged pin. Nothing would error; the
 *     button would just stop working.
 *   - the report form's `capture="environment"` file input opens the camera
 *     through the platform picker. That is probably not governed by this header,
 *     and "probably" is the wrong confidence level when being wrong means nobody
 *     can photograph anything on a phone.
 *
 * So this file asserts the two allows as hard requirements. A future tightening
 * pass that reaches for a blanket deny list fails here and reads why.
 *
 * Asserted against the config rather than a live response because the value has
 * to be right before it can be served; that the config is applied at all was
 * checked by hand against a running server on every path shape, including
 * `/api/*`.
 *
 * The Content-Security-Policy and X-Powered-By, at the end, came later
 * (October 2026), and are also read off a running server, because what they
 * hold depends on the environment the site was built in.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_URL, requireServer } from "./helpers.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(WEB, p), "utf8");
const src = read("next.config.ts");

/** The Permissions-Policy list, read out of the config source. */
function policy() {
  const block = src.match(/const PERMISSIONS_POLICY = \[([\s\S]*?)\]\.join/);
  assert.ok(block, "PERMISSIONS_POLICY is not declared as a joined array any more");
  return block[1]
    .split(",")
    .map((l) => l.trim().replace(/^"|",?$/g, ""))
    .filter(Boolean);
}

describe("the headers are configured", () => {
  test("headers() exists and covers every path including trailing slashes", () => {
    assert.match(src, /async headers\(\)/);
    assert.match(src, /source: "\/:path\*\{\/\}\?"/);
  });

  for (const [key, value] of [
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ]) {
    test(`${key}: ${value}`, () => {
      assert.ok(
        src.includes(`{ key: "${key}", value: "${value}" }`),
        `${key} should be sent as ${value}`,
      );
    });
  }

  test("Referrer-Policy does not leak the path cross-origin", () => {
    // A species path can itself be sensitive — /species/37689 names a protected
    // snake. Anything laxer than strict-origin sends that path to whatever the
    // reader clicks through to.
    const leaky = ["unsafe-url", "origin-when-cross-origin", "no-referrer-when-downgrade"];
    for (const p of leaky)
      assert.ok(!src.includes(`value: "${p}"`), `Referrer-Policy "${p}" leaks the path`);
  });
});

describe("Permissions-Policy keeps the report flow working", () => {
  test("geolocation is allowed for this origin", () => {
    const list = policy();
    assert.ok(
      list.includes("geolocation=(self)"),
      'geolocation must be allowed: LocationPicker calls getCurrentPosition, which this header governs. "use my location" would silently stop working.',
    );
    assert.ok(!list.includes("geolocation=()"), "geolocation is denied outright");
  });

  test("camera is allowed for this origin", () => {
    const list = policy();
    assert.ok(
      list.includes("camera=(self)"),
      'camera must be allowed: the report form uses capture="environment" and the cost of being wrong is that no one can photograph anything on a phone.',
    );
    assert.ok(!list.includes("camera=()"), "camera is denied outright");
  });

  test("the things nothing here uses are denied", () => {
    const list = policy();
    for (const feature of ["microphone", "payment", "usb", "display-capture"])
      assert.ok(
        list.includes(`${feature}=()`),
        `${feature} is unused and should not be reachable from an injected script`,
      );
  });

  test("every entry is well formed", () => {
    // A typo like `geolocation=self` (no parentheses) is ignored by the browser,
    // so the whole directive silently does nothing.
    for (const entry of policy())
      assert.match(
        entry,
        /^[a-z-]+=\((self)?\)$/,
        `"${entry}" is not a valid Permissions-Policy allowlist — browsers drop malformed directives silently`,
      );
  });
});

/*
 * The Content-Security-Policy, and the header the site no longer sends.
 *
 * Read from the config itself, with the environment set as each place that
 * builds the site sets it, because the policy names hosts that come from the
 * environment (Supabase's) and directives that depend on where it runs.
 * Then from a running server, to show what is built is what is served.
 */
const config = (await import("../next.config.ts")).default;

/** The two policies as `headers()` builds them under `env`, as directive -> sources. */
async function policies(env = {}) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    const [rule] = await config.headers();
    const value = (key) => rule.headers.find((h) => h.key === key)?.value;
    return {
      enforced: parsePolicy(value("Content-Security-Policy")),
      reportOnly: parsePolicy(value("Content-Security-Policy-Report-Only")),
      raw: [value("Content-Security-Policy"), value("Content-Security-Policy-Report-Only")],
    };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function parsePolicy(value) {
  assert.ok(value, "the policy is not sent");
  const out = new Map();
  for (const part of value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    assert.ok(name, `"${value}" has an empty directive`);
    assert.ok(!out.has(name), `${name} appears twice: a browser reads the first and ignores the rest`);
    out.set(name, sources);
  }
  return out;
}

/** Production, as Vercel builds it: NODE_ENV production, VERCEL set, a Supabase project. */
const PRODUCTION = {
  NODE_ENV: "production",
  VERCEL: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  NEXT_PUBLIC_MAPTILER_KEY: undefined,
};

describe("the enforced Content-Security-Policy", () => {
  test("holds the directives nothing on the site needs the other side of", async () => {
    const { enforced } = await policies(PRODUCTION);
    assert.deepEqual(enforced.get("frame-ancestors"), ["'none'"]);
    assert.deepEqual(enforced.get("base-uri"), ["'self'"]);
    assert.deepEqual(enforced.get("object-src"), ["'none'"]);
    assert.deepEqual(enforced.get("form-action"), ["'self'"]);
    assert.ok(enforced.has("upgrade-insecure-requests"), "production upgrades a stray http:// address");
  });

  test("upgrades insecure requests only on Vercel, where the page is https", async () => {
    // On a laptop's or CI's http://localhost the page itself is http, and a
    // browser that does not count localhost as secure would send the server's
    // own requests to an https port nothing answers on.
    const { enforced } = await policies({ ...PRODUCTION, VERCEL: undefined });
    assert.ok(!enforced.has("upgrade-insecure-requests"));
    assert.deepEqual(enforced.get("frame-ancestors"), ["'none'"]);
  });

  test("restricts nothing a page loads, which is the report-only half's job", async () => {
    // Enforcing a script-src, connect-src or the like before it has been
    // measured is how a policy blanks the map or the Turnstile widget. Moving
    // one here is a decision, and this is where it is recorded.
    const { enforced } = await policies(PRODUCTION);
    for (const name of ["default-src", "script-src", "style-src", "img-src", "connect-src", "worker-src", "frame-src"])
      assert.ok(!enforced.has(name), `${name} is enforced`);
  });
});

describe("the report-only Content-Security-Policy", () => {
  test("covers the scripts the site runs, and no eval outside next dev", async () => {
    const { reportOnly } = await policies(PRODUCTION);
    const script = reportOnly.get("script-src");
    assert.ok(script.includes("'self'"), "the site's own scripts, MapLibre's modules among them");
    assert.ok(
      script.includes("'unsafe-inline'"),
      "Next writes each page's payload as inline scripts, and a nonce needs every page rendered per request",
    );
    const turnstile = new URL(read("components/report/Turnstile.tsx").match(/"(https:\/\/challenges\.cloudflare\.com[^"]*)"/)[1]).origin;
    assert.ok(script.includes(turnstile), "Turnstile's script");
    assert.ok(!script.includes("'unsafe-eval'"), "nothing here needs eval in production");
    assert.ok(!script.some((s) => s === "*" || s === "https:" || s === "http:"), "a wildcard allows any script");

    const dev = await policies({ ...PRODUCTION, NODE_ENV: "development", VERCEL: undefined });
    assert.ok(dev.reportOnly.get("script-src").includes("'unsafe-eval'"), "React's dev overlay uses eval");
  });

  test("names the basemap's host, Supabase, and Turnstile's frame", async () => {
    const { reportOnly } = await policies(PRODUCTION);
    const { OPENFREEMAP_DARK } = await import("../lib/basemap.ts");
    const connect = reportOnly.get("connect-src");
    assert.ok(connect.includes(new URL(OPENFREEMAP_DARK).origin), "the basemap's style, tiles, glyphs and sprite");
    assert.ok(connect.includes("https://abcdefgh.supabase.co"), "sign-in and photo uploads");
    assert.ok(reportOnly.get("img-src").includes("https://abcdefgh.supabase.co"), "signed Storage URLs for photos");
    assert.deepEqual(reportOnly.get("worker-src"), ["'self'", "blob:"]);
    assert.deepEqual(reportOnly.get("frame-src"), ["https://challenges.cloudflare.com"]);
    assert.ok(!connect.includes("https://api.maptiler.com"), "MapTiler only when a key is set");

    const keyed = await policies({ ...PRODUCTION, NEXT_PUBLIC_MAPTILER_KEY: "k" });
    assert.ok(keyed.reportOnly.get("connect-src").includes("https://api.maptiler.com"));

    // A preview has no Supabase, and the policy then names none rather than
    // "null" or an empty source.
    const preview = await policies({ ...PRODUCTION, NEXT_PUBLIC_SUPABASE_URL: undefined });
    assert.deepEqual(preview.reportOnly.get("connect-src"), ["'self'", new URL(OPENFREEMAP_DARK).origin]);
  });

  test("reports to nobody: no endpoint collects or stores a violation", async () => {
    // A report carries the page's address, which can name a protected species
    // (Referrer-Policy above). The console is where violations are read.
    for (const raw of (await policies(PRODUCTION)).raw)
      assert.doesNotMatch(raw, /report-(uri|to)/);
  });
});

describe("no X-Powered-By", () => {
  test("the config turns it off", () => {
    assert.equal(config.poweredByHeader, false);
  });
});

describe("what a running server sends", () => {
  // A page, a localised page, an API route, the service worker (whose own
  // requests the report-only half governs) and one of MapLibre's modules.
  for (const path of ["/", "/en/species", "/api/health", "/sw.js", "/maplibre/maplibre-gl-worker.mjs"]) {
    test(path, async (t) => {
      if (!(await requireServer(t))) return;
      const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
      await res.body?.cancel();
      assert.equal(res.headers.get("x-powered-by"), null, "X-Powered-By is still sent");
      const enforced = parsePolicy(res.headers.get("content-security-policy"));
      assert.deepEqual(enforced.get("frame-ancestors"), ["'none'"]);
      assert.deepEqual(enforced.get("object-src"), ["'none'"]);
      const reportOnly = parsePolicy(res.headers.get("content-security-policy-report-only"));
      assert.ok(reportOnly.get("script-src").includes("https://challenges.cloudflare.com"));
      assert.ok(reportOnly.get("connect-src").includes("https://tiles.openfreemap.org"));
    });
  }
});
