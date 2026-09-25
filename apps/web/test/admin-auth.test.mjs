/**
 * Moderation is authorised per action, not per page.
 *
 * A Next.js server action is a public HTTP endpoint. Rendering the admin page
 * behind a role check does nothing to protect the actions it links to — anyone
 * who knows the action id can invoke it directly. So every exported action has to
 * re-check the caller's role itself, and the realistic way that breaks is not
 * someone removing a guard but someone adding a *fourth* action and forgetting
 * one. That is what this pins.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, BASE_URL } from "./helpers.mjs";

after(() => sql.end());

const ACTIONS_PATH = join(import.meta.dirname, "..", "app", "[locale]", "(site)", "admin", "actions.ts");
const src = readFileSync(ACTIONS_PATH, "utf8");

describe("admin server actions", () => {
  test("every exported action re-checks the caller's role", () => {
    // Split on exported async functions and check each body independently.
    const parts = src.split(/export\s+async\s+function\s+/).slice(1);
    assert.ok(parts.length >= 3, `expected several exported actions, found ${parts.length}`);

    for (const part of parts) {
      const name = part.slice(0, part.indexOf("("));
      const body = part.slice(0, part.indexOf("\nexport") === -1 ? part.length : part.indexOf("\nexport"));
      assert.match(
        body,
        /requireModerator\(\)/,
        `admin action "${name}" does not call requireModerator(). A server action is a ` +
          `public endpoint; gating the page that links to it is not authorisation.`,
      );
    }
  });

  test("the guard rejects anyone who is not a moderator or admin", () => {
    const guard = src.slice(src.indexOf("async function requireModerator"));
    const body = guard.slice(0, guard.indexOf("\n}"));
    assert.match(body, /!userId/, "an anonymous caller must be rejected");
    assert.match(body, /moderator/, "role must be checked");
    assert.match(body, /admin/, "admin must also be permitted");
    assert.match(body, /throw/, "the guard must throw, not return a falsy value the caller may ignore");
  });
});

/**
 * What the page says to a signed-in person who is NOT a moderator.
 *
 * Any account can reach /admin, so this branch is public copy. It used to print
 * a hardcoded English sentence — on a site whose default locale is Traditional
 * Chinese — and the SQL to self-promote, with the reader's own user id in it.
 * Knowing the statement grants nobody the ability to run it, so it was never a
 * hole; it was the app narrating its own privilege model, unprompted and in the
 * wrong language. Useful locally, so it is gated rather than removed.
 */
const PAGE_PATH = join(import.meta.dirname, "..", "app", "[locale]", "(site)", "admin", "page.tsx");
const pageSrc = readFileSync(PAGE_PATH, "utf8");

describe("the admin page when signed in without the role", () => {
  test("the refusal itself is translated, not hardcoded", () => {
    assert.match(pageSrc, /t\("moderatorsOnly"\)/);
  });

  test("the setup hint cannot render in production", () => {
    const hint = pageSrc.indexOf("Grant yourself access with:");
    assert.notEqual(hint, -1, "the setup hint is gone entirely — if that was deliberate, delete this test");

    assert.match(
      pageSrc,
      /const showSetupHint = process\.env\.VERCEL_ENV !== "production"/,
      "the gate must be the same production test the design lab uses",
    );

    // Containment, not ordering. The first version of this test compared the
    // INDEX of the gate against the index of the hint, which still passed when
    // the hint was moved out from under the conditional — the `const` was
    // declared above it either way. Proved by ungating the hint and watching
    // this assertion stay green. So: walk the parens from the conditional and
    // require the hint to fall inside.
    const open = pageSrc.indexOf("{showSetupHint && (");
    assert.notEqual(open, -1, "the setup hint is not wrapped in a {showSetupHint && (…)} conditional");

    let depth = 0;
    let close = -1;
    for (let i = open; i < pageSrc.length; i++) {
      const c = pageSrc[i];
      if (c === "{" || c === "(") depth++;
      else if (c === "}" || c === ")") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    assert.notEqual(close, -1, "the conditional wrapping the setup hint is unbalanced");
    assert.ok(
      hint > open && hint < close,
      "the setup hint is rendered outside its gate, so production would show it",
    );
  });

  test("no other user-facing English is hardcoded in this branch", () => {
    // The gated hint is the one exception and is allowed to be English: it is
    // addressed to whoever is setting up a local database, not to a visitor.
    const branch = pageSrc.slice(
      pageSrc.indexOf('if (role !== "moderator"'),
      pageSrc.indexOf("const rows = await sql"),
    );
    const withoutHint = branch.replace(/\{showSetupHint && \([\s\S]*?\)\}/, "");
    assert.doesNotMatch(
      withoutHint,
      />\s*[A-Z][a-z]+ [a-z]+/,
      "a sentence is hardcoded here; it needs a key in both catalogues",
    );
  });
});

describe("the admin page when signed out", () => {
  test("renders a sign-in prompt and no report data", async () => {
    const res = await fetch(`${BASE_URL}/admin`);
    assert.equal(res.status, 200);
    const html = await res.text();

    // The pending queue is exactly what must not reach an anonymous visitor.
    const [row] = await sql`
      select id::text from reports where status = 'pending' limit 1`;
    if (row) {
      assert.ok(!html.includes(row.id), "a pending report id leaked to an anonymous visitor");
    }

    // No report UUID of any kind should appear.
    const uuids = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
    if (uuids.length) {
      const known = await sql`
        select count(*)::int as n from reports where id::text = any(${uuids}::text[])`;
      assert.equal(known[0].n, 0, `report ids appeared in the signed-out admin page: ${uuids.slice(0, 3)}`);
    }
  });
});
