/**
 * The forum's moderation and retention rules, held to what the security audit
 * of 29 September 2026 found: a moderator approving their own held post by
 * leaving and rejoining, a moderator lifting an admin's suspension of another
 * moderator, legal holds that three purge steps did not see, poster data kept
 * from the writing rather than the removal, and first-post review switched off
 * by posts still in the queue. The screen's own cases are in
 * forum-screen.test.mjs.
 *
 *   node --test test/forum-audit.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const moderation = read("app", "[locale]", "(site)", "community", "moderation", "actions.ts");
const retention = read("app", "api", "jobs", "forum-retention", "route.ts");

describe("nobody reviews their own post", () => {
  test("the author comes from the post's metadata when the post has lost it", () => {
    assert.match(moderation, /coalesce\(p\.author_id,\s+\(select pm\.author_id from forum_post_meta pm where pm\.post_id = p\.id\)\)/);
    // Every query that feeds canReview reads the author that way.
    const reviews = moderation.match(/if \(!canReview\(actor\.id, post\.author_id, actor\.role\)\)/g) ?? [];
    const reads = moderation.match(/select \$\{POST_AUTHOR\} as author_id/g) ?? [];
    assert.ok(reviews.length >= 4);
    assert.equal(reads.length, reviews.length, "a review reads the author without the fallback");
  });
});

describe("a post whose author cannot be told", () => {
  test("is an admin's to decide, and its metadata is kept while it is held", () => {
    assert.match(read("lib", "forum", "policy.ts"), /if \(authorId === null\) return actorRole === "admin";/);
    assert.match(retention, /and p\.status <> 'held'/);
  });
});

describe("a suspension is lifted only by someone who could have given it", () => {
  const lift = moderation.slice(moderation.indexOf("export async function liftSuspension"));
  const body = lift.slice(0, lift.indexOf("\n}\n"));

  test("not on a moderator, by a moderator", () => {
    assert.match(body, /if \(!canSanction\(actor, \{ id: s\.user_id, role: s\.target_role \}\)\) return "cannotSanction";/);
  });

  test("not one an admin gave, by anyone but an admin", () => {
    assert.match(body, /if \(s\.imposer_role === "admin" && actor\.role !== "admin"\) return "adminOnly";/);
  });
});

describe("retention", () => {
  const step = (name) => {
    const start = retention.indexOf(`const ${name} = await sql\``);
    return retention.slice(start, retention.indexOf("returning 1`", start));
  };

  for (const name of ["posts", "meta", "revisions", "flags"])
    test(`${name}: nothing in a thread under legal hold is purged`, () => {
      assert.match(step(name), /not t\.legal_hold/);
      assert.match(step(name), /not p2?\.legal_hold/);
    });

  test("a poster's data is kept 180 days from the post's last removal, not its writing", () => {
    assert.match(step("meta"), /greatest\(m2\.created_at, p\.reviewed_at, p\.deleted_at, p\.edited_at, t\.deleted_at\)/);
  });
});

describe("first-post review", () => {
  test("lasts until two posts are out, not until two were written", () => {
    const src = read("app", "[locale]", "(site)", "community", "actions.ts");
    assert.match(src, /where author_id = \$\{viewer\.userId\}::uuid and status = 'visible'/);
  });
});
