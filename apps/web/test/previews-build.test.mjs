/**
 * One throw during prerender ends the whole build.
 *
 * `SiteHeader` asks `currentUserId()` on every page, so it runs inside the
 * prerender of every static page. `serverSupabase()` throws when Supabase is not
 * configured, and Next does not skip that page and carry on — it stops:
 *
 *     Error occurred prerendering page "/zh-TW"
 *     Error: NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not set
 *     Export encountered an error on /[locale]/page: /zh-TW, exiting the build.
 *
 * Vercel's Preview environment has no `NEXT_PUBLIC_SUPABASE_*` values, so **every
 * preview deployment on this project failed**, on every branch, for weeks —
 * including documentation-only ones, which is what finally gave it away. The
 * build died around page 650 of 862 every time and no pull request ever had a
 * working preview. Nothing reported it as broken: the GitHub check sat on
 * "pending" rather than turning red.
 *
 * Both directions were reproduced locally before this was written:
 *
 *     VERCEL_ENV=preview    + both vars empty -> 862/862 pages, build succeeds
 *     VERCEL_ENV=production + both vars empty -> dies on /en, as it must
 *
 * The second is the half worth protecting. Degrading everywhere would mean a
 * production deployment that lost these would render signed-out to people who
 * are signed in, and build green while doing it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(import.meta.dirname, "..", "lib", "supabase", "server.ts"),
  "utf8",
);

/** The body of `currentUserId`, by brace matching rather than by line. */
function currentUserIdBody() {
  const start = src.indexOf("export async function currentUserId");
  assert.notEqual(start, -1, "currentUserId is gone or renamed");
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced braces in currentUserId");
}

describe("a preview with no Supabase configuration can still build", () => {
  test("currentUserId answers null instead of throwing", () => {
    const body = currentUserIdBody();
    assert.match(
      body,
      /return null;/,
      "currentUserId must be able to answer null, or every preview build dies in prerender",
    );
  });

  test("the escape is conditional on not being production", () => {
    const body = currentUserIdBody();
    assert.match(
      body,
      /process\.env\.VERCEL_ENV !== "production"/,
      "the null answer must be scoped to non-production",
    );
    // Containment: the guard and the early return have to be the same statement.
    // A `return null` that merely sits after the check would degrade production
    // too, and a production deployment that lost these variables would then
    // render signed-out to signed-in people and build green doing it.
    assert.match(
      body,
      /if \(!authConfigured\(\) && process\.env\.VERCEL_ENV !== "production"\) return null;/,
      "the production test and the null answer must be one statement",
    );
  });

  test("production still reaches the throw", () => {
    // Not duplicated here — it falls through to serverSupabase(), which throws.
    const body = currentUserIdBody();
    assert.match(body, /await serverSupabase\(\)/);
  });
});

describe("the paths that genuinely need a client still demand one", () => {
  test("serverSupabase itself throws unconditionally", () => {
    // auth/callback and api/reports call this directly and are never
    // prerendered. Neither can do anything useful without a real client, so
    // neither should be softened along with the header.
    const start = src.indexOf("export async function serverSupabase");
    const body = src.slice(start, src.indexOf("export async function currentUserId"));
    assert.match(
      body,
      /if \(!url \|\| !key\) throw new Error/,
      "serverSupabase must keep throwing; only the header's question is optional",
    );
    assert.doesNotMatch(
      body,
      /VERCEL_ENV/,
      "serverSupabase must not gain an environment escape hatch",
    );
  });
});
