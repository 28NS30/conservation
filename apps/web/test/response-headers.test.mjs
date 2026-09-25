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
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(WEB, "next.config.ts"), "utf8");

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
