/**
 * The forum's rules that are numbers or yes/no answers: who may join, who may
 * suspend whom and for how long, who may make a moderator, which flags hide a
 * post at once. lib/forum/policy.ts holds them in one place so the pages and
 * the actions cannot disagree; these hold them down.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canReview,
  canSanction,
  canSetRole,
  flagHidesAtOnce,
  isFlagReason,
  joinDecision,
  maxSuspensionDays,
  boundedText,
  postingLimits,
  FLAG_REASONS,
  GUIDELINES_VERSION,
  RETENTION_DAYS,
} from "../lib/forum/policy.ts";

const member = { id: "m", role: "user" };
const member2 = { id: "m2", role: "user" };
const mod = { id: "d", role: "moderator" };
const mod2 = { id: "d2", role: "moderator" };
const admin = { id: "a", role: "admin" };
const admin2 = { id: "a2", role: "admin" };

describe("joining", () => {
  test("under 13 is refused", () => {
    assert.deepEqual(joinDecision("under_13", true), { ok: false, error: "tooYoung" });
  });
  test("13 to 17 needs the guardian acknowledgement", () => {
    assert.deepEqual(joinDecision("13_17", false), { ok: false, error: "needGuardian" });
    assert.deepEqual(joinDecision("13_17", true), { ok: true, ageBand: "13_17" });
  });
  test("18 and over does not", () => {
    assert.deepEqual(joinDecision("18_plus", false), { ok: true, ageBand: "18_plus" });
  });
  test("no answer, or a made-up one, is not an age", () => {
    for (const v of [null, "", "12", "adult", "18"]) assert.equal(joinDecision(v, true).ok, false, String(v));
  });
});

describe("suspensions", () => {
  test("a moderator suspends members, and only members", () => {
    assert.equal(canSanction(mod, member), true);
    assert.equal(canSanction(mod, mod2), false);
    assert.equal(canSanction(mod, admin), false);
  });
  test("an admin suspends members and moderators, never an admin", () => {
    assert.equal(canSanction(admin, member), true);
    assert.equal(canSanction(admin, mod), true);
    assert.equal(canSanction(admin, admin2), false);
  });
  test("nobody suspends themselves, and members suspend nobody", () => {
    assert.equal(canSanction(mod, mod), false);
    assert.equal(canSanction(admin, admin), false);
    assert.equal(canSanction(member, member2), false);
    // The only case where "not yourself" is the rule that decides: the same
    // person read twice with different roles, as a stale read would give.
    assert.equal(canSanction({ id: "x", role: "admin" }, { id: "x", role: "user" }), false);
  });
  test("up to 7 days for a moderator, longer only for an admin", () => {
    assert.equal(maxSuspensionDays("moderator"), 7);
    assert.ok(maxSuspensionDays("admin") > 7);
    assert.equal(maxSuspensionDays("user"), 0);
    assert.equal(maxSuspensionDays(null), 0);
  });
});

describe("roles", () => {
  test("an admin makes and unmakes moderators", () => {
    assert.equal(canSetRole(admin, member, "moderator"), true);
    assert.equal(canSetRole(admin, mod, "user"), true);
  });
  test("but never an admin, and never to or from admin", () => {
    assert.equal(canSetRole(admin, member, "admin"), false);
    assert.equal(canSetRole(admin, admin2, "user"), false);
  });
  test("a moderator changes nobody's role, and nobody changes their own", () => {
    assert.equal(canSetRole(mod, member, "moderator"), false);
    assert.equal(canSetRole(admin, admin, "user"), false);
  });
  test("a role that does not exist is refused", () => {
    assert.equal(canSetRole(admin, member, "owner"), false);
    assert.equal(canSetRole(admin, member, undefined), false);
  });
});

describe("review", () => {
  test("nobody decides on their own post", () => {
    assert.equal(canReview("d", "d"), false);
    assert.equal(canReview("d", "m"), true);
  });
  test("a post whose author cannot be told is an admin's to decide", () => {
    // An author who cannot be told: an admin's decision, not any moderator's.
    assert.equal(canReview("d", null), false);
    assert.equal(canReview("d", null, "moderator"), false);
    assert.equal(canReview("d", null, "admin"), true);
  });
});

describe("flags", () => {
  test("location, personal information and safety hide a post at once", () => {
    for (const r of ["sensitive_location", "personal_info", "safety"]) assert.equal(flagHidesAtOnce(r), true, r);
    for (const r of ["spam", "other"]) assert.equal(flagHidesAtOnce(r), false, r);
  });
  test("the reasons are the five the migration allows", () => {
    const sql = (
      /reason\s+text not null check \(reason in\s*\(([^)]*)\)\)/.exec(
        readFileSync(new URL("../../../supabase/migrations/0019_forum.sql", import.meta.url), "utf8"),
      ) ?? []
    )[1];
    assert.ok(sql, "could not find the flag reasons in 0019");
    const allowed = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual([...FLAG_REASONS].sort(), allowed);
    assert.equal(isFlagReason("harassment"), false);
  });
});

describe("text and limits", () => {
  test("text is trimmed and measured in characters, not bytes", () => {
    assert.equal(boundedText("  穿山甲  ", 2, 5), "穿山甲");
    assert.equal(boundedText("穿", 2, 5), null);
    assert.equal(boundedText("🐸🐸", 2, 2), "🐸🐸");
    assert.equal(boundedText(42, 1, 5), null);
  });
  test("new accounts get the smaller budgets", () => {
    const n = postingLimits(true);
    const o = postingLimits(false);
    for (const k of ["burst", "threadsPerDay", "postsPerDay"]) assert.ok(n[k].budget < o[k].budget, k);
  });
  test("retention is the 180 days the law asks for, and the guidelines have a version", () => {
    assert.equal(RETENTION_DAYS, 180);
    assert.ok(GUIDELINES_VERSION >= 1);
  });
});
