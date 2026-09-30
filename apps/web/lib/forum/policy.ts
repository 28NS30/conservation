/**
 * The forum's rules that are numbers or yes/no answers, in one pure module.
 *
 * Kept free of the database and of Next so the unit tests can hold each rule
 * down directly (test/forum-policy.test.mjs), and so the pages and the actions
 * read the same numbers: a page that says "up to 7 days" beside an action that
 * allows 30 is a rule nobody can trust.
 */

export type ForumRole = "user" | "moderator" | "admin";

/**
 * The guidelines a member has accepted, by version. Raise this when the rules
 * change in substance: everyone is then asked to read and accept them again
 * before their next post, and nobody is locked out of reading meanwhile.
 */
export const GUIDELINES_VERSION = 1;

/** Accounts younger than this post links only after review. */
export const NEW_ACCOUNT_DAYS = 7;

/** Soft-deleted posts, IP hashes and edit history are purged after this long. */
export const RETENTION_DAYS = 180;

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const BODY_MIN = 2;
export const BODY_MAX = 5000;
export const NOTE_MAX = 500;
export const REASON_MIN = 3;
export const REASON_MAX = 500;

export const THREADS_PER_PAGE = 20;
/** Top-level replies on a page of a thread, each with every reply under it. */
export const REPLIES_PER_PAGE = 20;

/**
 * How deep replies nest: a reply to the thread is on the first level, a reply
 * to that on the second, and so on to the fourth. A reply to a fourth-level
 * reply goes beside it rather than under it, marked with whom it answers, so
 * a long back-and-forth does not march off the side of a phone. Migration
 * 0030 (forum_place_reply) holds the same number; test/forum-policy.test.mjs
 * checks they agree.
 */
export const REPLY_DEPTH_MAX = 4;

/** A one-flag hide: these three cannot wait for a second opinion. */
export const URGENT_FLAG_REASONS = ["sensitive_location", "personal_info", "safety"] as const;
export const FLAG_REASONS = [...URGENT_FLAG_REASONS, "spam", "other"] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];
/** Distinct flags of the other reasons that hide a post pending review. */
export const FLAGS_TO_HIDE = 3;

export function isFlagReason(v: unknown): v is FlagReason {
  return typeof v === "string" && (FLAG_REASONS as readonly string[]).includes(v);
}

export function flagHidesAtOnce(reason: FlagReason): boolean {
  return (URGENT_FLAG_REASONS as readonly string[]).includes(reason);
}

/**
 * Per-account posting budgets, in the shape bump_rate_limit() takes.
 *
 * Two tiers, by account age, because the commonest abuse is a fresh account
 * posting fast. A person talking about animals posts a few times a day; the
 * numbers leave room for an enthusiastic one and stop a script.
 */
export function postingLimits(newAccount: boolean) {
  return {
    burst: { windowSeconds: 60, budget: newAccount ? 2 : 4 },
    threadsPerDay: { windowSeconds: 86_400, budget: newAccount ? 3 : 10 },
    postsPerDay: { windowSeconds: 86_400, budget: newAccount ? 20 : 100 },
    flagsPerDay: { windowSeconds: 86_400, budget: 20 },
    // Votes are cheap to cast and cheap to script. Taking one back counts
    // too, or flipping a vote a thousand times would be free.
    votesBurst: { windowSeconds: 60, budget: newAccount ? 15 : 30 },
    votesPerDay: { windowSeconds: 86_400, budget: newAccount ? 150 : 500 },
  } as const;
}

/* ------------------------------------------------------------------ *
 * Votes
 * ------------------------------------------------------------------ */

export type VoteValue = -1 | 0 | 1;

/** A vote from a form: 1 up, -1 down, 0 to take it back. Anything else is not a vote. */
export function parseVote(v: unknown): VoteValue | null {
  if (v === "1" || v === 1) return 1;
  if (v === "-1" || v === -1) return -1;
  if (v === "0" || v === 0) return 0;
  return null;
}

/**
 * What a vote button sends, given the vote the member already has: pressing
 * the arrow you chose takes the vote back, pressing the other one changes it.
 *
 * The button carries the RESULT, not "toggle", so the action is idempotent: a
 * double tap on a slow connection sends the same answer twice rather than
 * voting and un-voting.
 */
export function nextVote(current: VoteValue, pressed: 1 | -1): VoteValue {
  return current === pressed ? 0 : pressed;
}

export type VoteTarget = {
  /** The voter wrote it (for the page) or is its author of record (for the action). */
  own: boolean;
  status: string;
  threadStatus: string;
  locked: boolean;
  archived: boolean;
};

/**
 * Why a member may not vote on this post, or null if they may.
 *
 * Only what the public can read is voted on: a held post has not been let out,
 * and a hidden or deleted one has been taken down, so a score on it would
 * count something nobody should be reacting to. Nobody votes for their own
 * words. And a locked thread is closed to everything new, votes included: a
 * moderator locks a thread to stop a pile-on, and a pile-on can be votes.
 * Migration 0030 refuses the first two in the database as well.
 */
export function voteRefusal(target: VoteTarget | null | undefined): "noPost" | "ownPost" | "locked" | null {
  if (!target) return "noPost";
  if (target.status !== "visible" || target.threadStatus !== "visible" || target.archived) return "noPost";
  if (target.own) return "ownPost";
  if (target.locked) return "locked";
  return null;
}

export const AGE_BANDS = ["under_13", "13_17", "18_plus"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/**
 * Who may join, from the age band they chose.
 *
 * 13 and over, with a guardian's acknowledgement from 13 to 17: the team's
 * default, pending the legal review the owner has to arrange (plan section 7).
 * Under 13 is refused and nothing about them is stored.
 */
export function joinDecision(ageBand: unknown, guardianAck: boolean):
  | { ok: true; ageBand: "13_17" | "18_plus" }
  | { ok: false; error: "tooYoung" | "needGuardian" | "chooseAge" } {
  if (ageBand === "under_13") return { ok: false, error: "tooYoung" };
  if (ageBand === "13_17") return guardianAck ? { ok: true, ageBand } : { ok: false, error: "needGuardian" };
  if (ageBand === "18_plus") return { ok: true, ageBand };
  return { ok: false, error: "chooseAge" };
}

export function isModeratorRole(role: string | null | undefined): role is "moderator" | "admin" {
  return role === "moderator" || role === "admin";
}

/**
 * The longest suspension this role may hand out. A moderator's is a cooling-off
 * period; anything longer changes someone's standing and is an admin's call.
 */
export function maxSuspensionDays(role: ForumRole | null): number {
  if (role === "admin") return 365;
  if (role === "moderator") return 7;
  return 0;
}

/**
 * Whether `actor` may suspend `target`.
 *
 * Moderators are often classmates of the people they moderate, and sometimes
 * of each other. So a moderator sanctions members only, an admin sanctions
 * members and moderators, nobody sanctions an admin from here (that is the
 * owner's, in SQL), and nobody sanctions themselves.
 */
export function canSanction(
  actor: { id: string; role: ForumRole | null },
  target: { id: string; role: ForumRole | null },
): boolean {
  if (actor.id === target.id) return false;
  if (target.role === "admin") return false;
  if (actor.role === "admin") return true;
  if (actor.role === "moderator") return target.role !== "moderator";
  return false;
}

/**
 * Whether `actor` may change `target`'s role to `next`.
 *
 * Admins grant and take away the moderator role, and that is all. Making an
 * admin — or unmaking one — stays with the owner, as a one-line SQL statement,
 * so that a single compromised admin account cannot mint more of itself.
 */
export function canSetRole(
  actor: { id: string; role: ForumRole | null },
  target: { id: string; role: ForumRole | null },
  next: unknown,
): next is "user" | "moderator" {
  if (actor.role !== "admin") return false;
  if (actor.id === target.id) return false;
  if (target.role === "admin") return false;
  return next === "user" || next === "moderator";
}

/**
 * Whether a moderator may decide on this post. Nobody approves their own held
 * post or rules on flags against their own words: a moderator who posts a
 * location is held like anyone else, and it takes a second one to let it out.
 *
 * A post whose author cannot be told (they left, and the metadata that
 * remembers them has been purged) is an admin's to decide, not any
 * moderator's: "nobody wrote it" let its own author approve it (review of the
 * security fixes, 30 September 2026).
 */
export function canReview(
  actorId: string,
  authorId: string | null,
  actorRole: ForumRole | null = null,
): boolean {
  if (authorId === null) return actorRole === "admin";
  return actorId !== authorId;
}

/** Trimmed text within bounds, or null. */
export function boundedText(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\r\n?/g, "\n").trim();
  const n = [...s].length;
  return n >= min && n <= max ? s : null;
}
