/**
 * The submission gate must not open itself when its configuration goes missing.
 *
 * `verifyTurnstile` is the single check in front of an anonymous endpoint that
 * writes to a database of protected-species locations. It used to return `true`
 * whenever `TURNSTILE_SECRET_KEY` was unset — which is right locally and in CI,
 * where there is no Cloudflare account, and wrong in production, where it makes
 * a dropped environment variable indistinguishable from a working gate.
 * Submissions would keep succeeding. The graphs would look normal. The gate
 * would simply not be there.
 *
 * This was not a live hole when it was changed: production answered
 * `403 challenge_failed` to a tokenless submission, so the key was set and the
 * branch was unreachable there. It closes a way to fail, not a way in.
 *
 * Asserted at the source level because `verifyTurnstile` reads `process.env`
 * directly and these tests cannot import TypeScript — the same reason
 * `offline-challenge.test.mjs` is blunt. A regression here is silent in every
 * environment a test can run in, which is exactly why it is worth pinning.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(import.meta.dirname, "..", "lib", "abuse.ts"),
  "utf8",
);

/** The body of `if (!secret) { … }`, by brace matching rather than by line. */
function missingSecretBranch() {
  const start = src.indexOf("if (!secret) {");
  assert.notEqual(
    start,
    -1,
    "the missing-key branch is gone or reshaped — if that was deliberate, rewrite this file rather than deleting it",
  );
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced braces in the missing-key branch");
}

describe("a missing Turnstile key", () => {
  test("refuses the submission in production", () => {
    const branch = missingSecretBranch();
    assert.match(
      branch,
      /process\.env\.VERCEL_ENV === "production"/,
      "the missing-key branch must distinguish production",
    );
    // Containment, not ordering: the refusal has to live INSIDE the production
    // test, not merely somewhere after it.
    const prod = branch.indexOf('process.env.VERCEL_ENV === "production"');
    const refuse = branch.indexOf("return false", prod);
    const permit = branch.indexOf("return true");
    assert.ok(refuse > prod, "production must reach a `return false`");
    assert.ok(
      refuse < permit,
      "the permissive return comes first, so production would still be allowed through",
    );
  });

  test("still permits it everywhere else", () => {
    // Local development and CI have no Cloudflare account. If this stops being
    // true the report form stops working on every developer machine at once.
    assert.match(
      missingSecretBranch(),
      /return true;?\s*$/m,
      "non-production must still pass, or the form breaks locally and in CI",
    );
  });

  test("a missing token is still refused regardless", () => {
    assert.match(src, /if \(!token\) return false;/);
  });
});

describe("the outage fail-open is left alone, deliberately", () => {
  test("a Cloudflare outage still allows the submission", () => {
    // NOT an oversight, and not this file's to change. Whether an outage should
    // let junk through or reject honest reports is a judgement about a public
    // map whose credibility is the product — the team's call, recorded in the
    // audit as open. This test exists so that changing it is a conscious act
    // with a conversation attached, rather than a tidy-up.
    const c = src.indexOf("} catch {");
    assert.notEqual(c, -1, "the verification request is no longer wrapped");
    const after = src.slice(c, c + 400);
    assert.match(
      after,
      /return true;/,
      "the outage path changed behaviour — if that is intended, it needs a team decision, not a green test",
    );
  });
});
