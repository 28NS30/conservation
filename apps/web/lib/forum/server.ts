import "server-only";

import { cache } from "react";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { currentUserId } from "@/lib/supabase/server";
import { forumEnabled } from "./gate";
import { GUIDELINES_VERSION, NEW_ACCOUNT_DAYS, isModeratorRole, type ForumRole } from "./policy";

/**
 * The forum's server-side entry points: the switch, and who is asking.
 *
 * `requireForum()` is the first line of every forum page, layout, route handler
 * and server action. A layout's notFound() is not enough on its own: Next
 * renders a layout and its page concurrently, so a page behind a closed layout
 * would still run its queries. And a server action is reachable by POST from
 * any page on the site whether or not a forum page ever rendered, so each one
 * has to ask for itself. test/forum-gate.test.mjs checks every one does, first.
 */
export function requireForum(): void {
  if (!forumEnabled()) notFound();
}

export type ForumMember = {
  handle: string;
  nicknameKey: string;
  nicknameNo: number;
  ageBand: "13_17" | "18_plus";
  guidelinesVersion: number;
  joinedAt: Date;
  /** Younger than NEW_ACCOUNT_DAYS: links are held, budgets are lower. */
  newAccount: boolean;
};

export type ForumViewer = {
  userId: string | null;
  /** From `profiles.role`, read here. Never from anything the client sent. */
  role: ForumRole | null;
  member: ForumMember | null;
  /** The end of the longest suspension in force, or null. */
  suspendedUntil: Date | null;
  /** Joined, on the current guidelines, and not suspended. */
  canPost: boolean;
  isModerator: boolean;
};

/**
 * The signed-in person as the forum sees them, once per request.
 *
 * One query, cached for the request with React's `cache`, because the layout,
 * the page and the composer all ask.
 */
export const forumViewer = cache(async (): Promise<ForumViewer> => {
  const userId = await currentUserId();
  if (!userId) {
    return { userId: null, role: null, member: null, suspendedUntil: null, canPost: false, isModerator: false };
  }
  const [row] = await sql<
    {
      role: ForumRole | null;
      handle: string | null;
      nickname_key: string | null;
      nickname_no: number | null;
      age_band: "13_17" | "18_plus" | null;
      guidelines_version: number | null;
      joined_at: Date | null;
      new_account: boolean | null;
      suspended_until: Date | null;
    }[]
  >`
    select pr.role, fp.handle, fp.nickname_key, fp.nickname_no, fp.age_band,
           fp.guidelines_version, fp.created_at as joined_at,
           fp.created_at > now() - ${NEW_ACCOUNT_DAYS} * interval '1 day' as new_account,
           (select max(s.ends_at) from forum_sanctions s
             where s.user_id = ${userId}::uuid and s.lifted_at is null
               and s.starts_at <= now() and s.ends_at > now()) as suspended_until
      from (select ${userId}::uuid as id) me
      left join profiles pr on pr.id = me.id
      left join forum_profiles fp on fp.user_id = me.id`;

  const role: ForumRole = row?.role ?? "user";
  const member: ForumMember | null = row?.handle
    ? {
        handle: row.handle,
        nicknameKey: row.nickname_key!,
        nicknameNo: row.nickname_no!,
        ageBand: row.age_band!,
        guidelinesVersion: row.guidelines_version!,
        joinedAt: row.joined_at!,
        newAccount: Boolean(row.new_account),
      }
    : null;
  const suspendedUntil = row?.suspended_until ?? null;
  return {
    userId,
    role,
    member,
    suspendedUntil,
    canPost: Boolean(member && member.guidelinesVersion >= GUIDELINES_VERSION && !suspendedUntil),
    isModerator: isModeratorRole(role),
  };
});

/**
 * A keyed hash of the caller's IP address, for the restricted post metadata.
 *
 * Keyed, because an unkeyed hash of an IPv4 address is not a hash at all:
 * there are four billion of them and every one can be tried in minutes. With
 * no key configured in production nothing is stored, rather than something
 * that only looks protected. Locally and in CI a fixed development key is
 * fine; there is nothing real to protect there.
 */
export async function requestFingerprint(): Promise<{ ipHash: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const key =
    process.env.FORUM_IP_HASH_KEY ||
    (process.env.VERCEL_ENV === "production" ? null : "local-development-forum-ip-key");
  const ipHash = ip && key ? createHmac("sha256", key).update(ip).digest("hex") : null;
  const ua = h.get("user-agent");
  return { ipHash, userAgent: ua ? ua.slice(0, 300) : null };
}

/** The lower-cased watched words, for the screen. */
export async function watchedWords(): Promise<string[]> {
  const rows = await sql<{ word: string }[]>`select word from forum_watched_words`;
  return rows.map((r) => r.word);
}

/** How many people hold a moderating role: the first-post review turns on at three. */
export async function moderatorCount(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from profiles where role in ('moderator', 'admin')`;
  return row?.n ?? 0;
}
