/**
 * /me is the only page that reads the base `reports` table on a visitor's
 * behalf.
 *
 * Everywhere else the public path goes through `reports_public`, which applies
 * the obscuring rules and hides anything still pending. This page deliberately
 * does not: the whole point is showing someone their OWN submission, including
 * the pending ones that are absent from the public view by design.
 *
 * That makes its WHERE clause the entire security boundary. There is no id
 * parameter to tamper with — the filter is the session's user id — and these
 * pin that it stays that way.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, BASE_URL } from "./helpers.mjs";

after(() => sql.end());

const PAGE = join(
  import.meta.dirname,
  "..",
  "app",
  "[locale]",
  "(site)",
  "me",
  "page.tsx",
);
const src = readFileSync(PAGE, "utf8");

describe("my reports", () => {
  test("the query is scoped to the signed-in user", () => {
    assert.match(
      src,
      /where\s+r\.reporter_id\s*=\s*\$\{userId\}/,
      "reports must be filtered by the session's user id, not by any parameter",
    );
  });

  test("the user id comes from the session, never from the request", () => {
    assert.match(
      src,
      /const userId = await currentUserId\(\)/,
      "userId must come from the auth session",
    );
    // A searchParams-derived user would let anyone read anyone's reports.
    assert.ok(
      !/searchParams/.test(src),
      "this page must not accept a user from the URL",
    );
  });

  test("signed-out visitors get the sign-in prompt, not a query", () => {
    const guardAt = src.indexOf("if (!userId)");
    const queryAt = src.indexOf("from reports r");
    assert.ok(guardAt > 0, "there must be a signed-out guard");
    assert.ok(
      guardAt < queryAt,
      "the guard has to return before the query runs",
    );
  });

  test("it is not indexable", () => {
    // One person's own contributions, including pending ones.
    assert.match(src, /robots:\s*\{\s*index:\s*false/, "must be noindex");
  });

  test("an anonymous request leaks no report ids", async () => {
    const res = await fetch(`${BASE_URL}/me`);
    assert.equal(res.status, 200);
    const html = await res.text();
    const uuids =
      html.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      ) ?? [];
    if (uuids.length) {
      const [{ n }] = await sql`
        select count(*)::int as n from reports where id::text = any(${uuids}::text[])`;
      assert.equal(n, 0, `report ids appeared for a signed-out visitor: ${uuids.slice(0, 3)}`);
    }
  });
});
