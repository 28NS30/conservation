"use server";

import type postgres from "postgres";
import { refresh } from "next/cache";
import { sql } from "@/lib/db";
import { currentRole } from "@/lib/auth";
import { requireForum } from "@/lib/forum/server";
import { screenText, LOCATION_REASONS } from "@/lib/forum/screen";
import {
  BODY_MAX,
  BODY_MIN,
  REASON_MAX,
  REASON_MIN,
  TITLE_MAX,
  TITLE_MIN,
  boundedText,
  canReview,
  canSanction,
  canSetRole,
  isModeratorRole,
  maxSuspensionDays,
  type ForumRole,
} from "@/lib/forum/policy";
import { isUuid } from "@/lib/forum/queries";
import { fail, ok, type ActionResult } from "@/lib/forum/result";

/**
 * The moderation console's actions.
 *
 * Every export does two things before anything else: `requireForum()`, so the
 * whole console is a 404 while the forum is off, and `requireModerator()` (or
 * `requireAdmin()`), which reads the role from `profiles` for the session's
 * user. A server action is a public HTTP endpoint: that the console page only
 * renders these forms for moderators protects nothing. test/forum-gate.test.mjs
 * fails if an export here skips either check or does anything before them.
 *
 * Each action writes its forum_mod_actions row inside the SAME transaction as
 * the change it records, for the reason admin/actions.ts gives: a shared
 * helper on its own connection would let the change commit and the audit row
 * fail, and an audit log with gaps is worse than none because it is believed.
 * The small repetition below is that choice, not an oversight.
 */

type Actor = { id: string; role: ForumRole };

/**
 * A moderator or admin who has joined the forum.
 *
 * Joined, because the audit log names people by their forum nickname — a
 * moderator without one would act anonymously. Throws rather than returning an
 * error result: a non-moderator reaching this is not a user mistake to be
 * explained, it is someone posting to an endpoint they were never shown.
 */
async function requireModerator(): Promise<Actor> {
  const { userId, role } = await currentRole();
  if (!userId || !isModeratorRole(role)) throw new Error("forbidden");
  const [member] = await sql`select 1 from forum_profiles where user_id = ${userId}::uuid`;
  if (!member) throw new Error("forbidden: join the forum first");
  return { id: userId, role };
}

async function requireAdmin(): Promise<Actor> {
  const actor = await requireModerator();
  if (actor.role !== "admin") throw new Error("forbidden");
  return actor;
}

function reasonFrom(form: FormData): string | null {
  return boundedText(form.get("reason"), REASON_MIN, REASON_MAX);
}

type PostForReview = {
  author_id: string | null;
  status: string;
  is_opener: boolean;
  thread_id: string;
};

/* ------------------------------------------------------------------ *
 * Posts
 * ------------------------------------------------------------------ */

/** Make a held or flagged post public, and close its flags as dismissed. */
export async function approvePost(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireModerator();
  const postId = String(form.get("post") ?? "");
  if (!isUuid(postId)) return fail("noPost");
  const note = String(form.get("reason") ?? "").trim().slice(0, REASON_MAX) || null;

  const result = await sql.begin(async (tx) => {
    const [post] = await tx<PostForReview[]>`
      select author_id, status, is_opener, thread_id from forum_posts
       where id = ${postId}::uuid for update`;
    if (!post || post.status === "deleted") return "noPost";
    if (!canReview(actor.id, post.author_id)) return "ownPost";

    await tx`
      update forum_posts
         set status = 'visible', held_reasons = '{}', moderator_note = null,
             reviewed_by = ${actor.id}::uuid, reviewed_at = now()
       where id = ${postId}::uuid`;
    if (post.is_opener)
      await tx`update forum_threads set status = 'visible' where id = ${post.thread_id}::uuid`;
    await tx`
      update forum_flags set status = 'dismissed', resolved_by = ${actor.id}::uuid, resolved_at = now()
       where post_id = ${postId}::uuid and status = 'open'`;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id, subject_user_id, reason)
      values (${actor.id}::uuid, 'approve', 'post', ${postId}, ${post.author_id}::uuid, ${note})`;
    return null;
  });
  if (result) return fail(result);
  refresh();
  return ok("approved");
}

/** Take a post out of public view, keeping it, with a reason its author sees. */
export async function hidePost(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireModerator();
  const postId = String(form.get("post") ?? "");
  if (!isUuid(postId)) return fail("noPost");
  const reason = reasonFrom(form);
  if (!reason) return fail("reasonRequired");

  const result = await sql.begin(async (tx) => {
    const [post] = await tx<PostForReview[]>`
      select author_id, status, is_opener, thread_id from forum_posts
       where id = ${postId}::uuid for update`;
    if (!post || post.status === "deleted") return "noPost";
    if (!canReview(actor.id, post.author_id)) return "ownPost";

    await tx`
      update forum_posts
         set status = 'hidden', moderator_note = ${reason},
             reviewed_by = ${actor.id}::uuid, reviewed_at = now()
       where id = ${postId}::uuid`;
    if (post.is_opener)
      await tx`update forum_threads set status = 'hidden' where id = ${post.thread_id}::uuid`;
    await tx`
      update forum_flags set status = 'upheld', resolved_by = ${actor.id}::uuid, resolved_at = now()
       where post_id = ${postId}::uuid and status = 'open'`;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id, subject_user_id, reason)
      values (${actor.id}::uuid, 'hide', 'post', ${postId}, ${post.author_id}::uuid, ${reason})`;
    return null;
  });
  if (result) return fail(result);
  refresh();
  return ok("postHidden");
}

/**
 * Soft-delete a post. The text leaves the forum now and is purged by the
 * retention job after 180 days, unless it is under legal hold. Deleting an
 * opening post deletes its thread.
 */
export async function deletePost(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireModerator();
  const postId = String(form.get("post") ?? "");
  if (!isUuid(postId)) return fail("noPost");
  const reason = reasonFrom(form);
  if (!reason) return fail("reasonRequired");

  const result = await sql.begin(async (tx) => {
    const [post] = await tx<PostForReview[]>`
      select author_id, status, is_opener, thread_id from forum_posts
       where id = ${postId}::uuid for update`;
    if (!post || post.status === "deleted") return "noPost";
    if (!canReview(actor.id, post.author_id)) return "ownPost";

    await tx`
      update forum_posts
         set status = 'deleted', deleted_at = now(), moderator_note = ${reason},
             reviewed_by = ${actor.id}::uuid, reviewed_at = now()
       where id = ${postId}::uuid`;
    if (post.is_opener)
      await tx`update forum_threads set status = 'deleted', deleted_at = now()
                where id = ${post.thread_id}::uuid`;
    await tx`
      update forum_flags set status = 'upheld', resolved_by = ${actor.id}::uuid, resolved_at = now()
       where post_id = ${postId}::uuid and status = 'open'`;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id, subject_user_id, reason)
      values (${actor.id}::uuid, 'delete', 'post', ${postId}, ${post.author_id}::uuid, ${reason})`;
    return null;
  });
  if (result) return fail(result);
  refresh();
  return ok("postDeleted");
}

/**
 * Edit a location (or anything else that should not be public) out of a post.
 *
 * The text as it was goes to forum_post_revisions, which only this console
 * reads and the retention job purges; the post is marked as edited by a
 * moderator, so readers know the words are not all the author's.
 *
 * With "approve after editing" ticked, the new text is screened again first,
 * and a location the edit missed keeps the post held. That is the one mistake
 * this form exists to prevent, so it is not left to the moderator's eye alone.
 */
export async function redactPost(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireModerator();
  const postId = String(form.get("post") ?? "");
  if (!isUuid(postId)) return fail("noPost");
  const reason = reasonFrom(form);
  if (!reason) return fail("reasonRequired");
  const body = boundedText(form.get("body"), BODY_MIN, BODY_MAX);
  if (!body) return fail("bodyLength");
  const rawTitle = form.get("title");
  const title = rawTitle === null ? null : boundedText(rawTitle, TITLE_MIN, TITLE_MAX);
  if (rawTitle !== null && !title) return fail("titleLength");
  const approve = form.get("approve") === "on";

  const stillLocated = screenText(`${title ?? ""}\n${body}`, { watchedWords: [], newAccount: false })
    .reasons.some((r) => LOCATION_REASONS.includes(r));

  const result = await sql.begin(async (tx) => {
    const [post] = await tx<(PostForReview & { body: string; title: string })[]>`
      select p.author_id, p.status, p.is_opener, p.thread_id, p.body, t.title
        from forum_posts p join forum_threads t on t.id = p.thread_id
       where p.id = ${postId}::uuid for update of p`;
    if (!post || post.status === "deleted") return "noPost";
    if (!canReview(actor.id, post.author_id)) return "ownPost";

    await tx`
      insert into forum_post_revisions (post_id, title_before, body_before, editor_id, reason)
      values (${postId}::uuid, ${post.is_opener ? post.title : null}, ${post.body},
              ${actor.id}::uuid, ${reason})`;
    await tx`
      update forum_posts
         set body = ${body}, edited_by_moderator = true, edited_at = now()
       where id = ${postId}::uuid`;
    if (post.is_opener && title)
      await tx`update forum_threads set title = ${title} where id = ${post.thread_id}::uuid`;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id, subject_user_id, reason)
      values (${actor.id}::uuid, 'redact', 'post', ${postId}, ${post.author_id}::uuid, ${reason})`;

    if (approve && !stillLocated) {
      await tx`
        update forum_posts
           set status = 'visible', held_reasons = '{}', moderator_note = null,
               reviewed_by = ${actor.id}::uuid, reviewed_at = now()
         where id = ${postId}::uuid`;
      if (post.is_opener)
        await tx`update forum_threads set status = 'visible' where id = ${post.thread_id}::uuid`;
      await tx`
        update forum_flags set status = 'upheld', resolved_by = ${actor.id}::uuid, resolved_at = now()
         where post_id = ${postId}::uuid and status = 'open'`;
      await tx`
        insert into forum_mod_actions (actor_id, action, target_type, target_id, subject_user_id, reason)
        values (${actor.id}::uuid, 'approve', 'post', ${postId}, ${post.author_id}::uuid, ${reason})`;
    }
    return null;
  });
  if (result) return fail(result);
  refresh();
  if (approve && stillLocated) return fail("stillHasLocation");
  return ok(approve ? "redactedApproved" : "redacted");
}

/* ------------------------------------------------------------------ *
 * Threads
 * ------------------------------------------------------------------ */

export async function setThreadLocked(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireModerator();
  const threadId = String(form.get("thread") ?? "");
  if (!isUuid(threadId)) return fail("noThread");
  const locked = form.get("locked") === "1";
  const reason = String(form.get("reason") ?? "").trim().slice(0, REASON_MAX) || null;

  const done = await sql.begin(async (tx) => {
    const [t] = await tx<{ author_id: string | null }[]>`
      update forum_threads set locked = ${locked} where id = ${threadId}::uuid returning author_id`;
    if (!t) return false;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id, subject_user_id, reason)
      values (${actor.id}::uuid, ${locked ? "lock" : "unlock"}, 'thread', ${threadId},
              ${t.author_id}::uuid, ${reason})`;
    return true;
  });
  if (!done) return fail("noThread");
  refresh();
  return ok(locked ? "threadLocked" : "threadUnlocked");
}

export async function setThreadPinned(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireModerator();
  const threadId = String(form.get("thread") ?? "");
  if (!isUuid(threadId)) return fail("noThread");
  const pinned = form.get("pinned") === "1";

  const done = await sql.begin(async (tx) => {
    const [t] = await tx<{ author_id: string | null }[]>`
      update forum_threads set pinned_at = ${pinned ? new Date() : null}
       where id = ${threadId}::uuid returning author_id`;
    if (!t) return false;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id, subject_user_id)
      values (${actor.id}::uuid, ${pinned ? "pin" : "unpin"}, 'thread', ${threadId}, ${t.author_id}::uuid)`;
    return true;
  });
  if (!done) return fail("noThread");
  refresh();
  return ok(pinned ? "threadPinned" : "threadUnpinned");
}

export async function moveThread(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireModerator();
  const threadId = String(form.get("thread") ?? "");
  if (!isUuid(threadId)) return fail("noThread");
  const slug = String(form.get("category") ?? "");

  const result = await sql.begin(async (tx) => {
    const [cat] = await tx<{ id: number }[]>`
      select id from forum_categories where slug = ${slug} and not archived`;
    if (!cat) return "noCategory";
    const [before] = await tx<{ category_id: number; author_id: string | null }[]>`
      select category_id, author_id from forum_threads where id = ${threadId}::uuid for update`;
    if (!before) return "noThread";
    await tx`update forum_threads set category_id = ${cat.id} where id = ${threadId}::uuid`;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id, subject_user_id, detail)
      values (${actor.id}::uuid, 'move', 'thread', ${threadId}, ${before.author_id}::uuid,
              ${sql.json({ from: before.category_id, to: cat.id })})`;
    return null;
  });
  if (result) return fail(result);
  refresh();
  return ok("threadMoved");
}

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

async function memberByHandle(
  tx: postgres.TransactionSql,
  handle: string,
): Promise<{ user_id: string; role: ForumRole } | null> {
  const [row] = await tx<{ user_id: string; role: ForumRole | null }[]>`
    select fp.user_id, pr.role from forum_profiles fp
      left join profiles pr on pr.id = fp.user_id
     where fp.handle = ${handle}`;
  return row ? { user_id: row.user_id, role: row.role ?? "user" } : null;
}

/**
 * Suspend a member: they can read, and cannot post, reply or flag, until it
 * ends. Up to 7 days for a moderator, longer for an admin; see canSanction()
 * for who may suspend whom.
 */
export async function suspendMember(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireModerator();
  const handle = String(form.get("handle") ?? "").trim();
  const days = Math.floor(Number(form.get("days")));
  const reason = reasonFrom(form);
  if (!reason) return fail("reasonRequired");
  if (!Number.isFinite(days) || days < 1 || days > maxSuspensionDays(actor.role)) return fail("tooLong");

  const result = await sql.begin(async (tx) => {
    const target = await memberByHandle(tx, handle);
    if (!target) return "noMember";
    if (!canSanction(actor, { id: target.user_id, role: target.role })) return "cannotSanction";
    const [s] = await tx<{ id: number }[]>`
      insert into forum_sanctions (user_id, ends_at, reason, actor_id)
      values (${target.user_id}::uuid, now() + ${days} * interval '1 day', ${reason}, ${actor.id}::uuid)
      returning id`;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id, subject_user_id, reason, detail)
      values (${actor.id}::uuid, 'suspend', 'user', ${handle}, ${target.user_id}::uuid, ${reason},
              ${sql.json({ days, sanction: s.id })})`;
    return null;
  });
  if (result) return fail(result);
  refresh();
  return ok("memberSuspended");
}

/**
 * End a suspension early. A moderator may lift one that a moderator could
 * have given (7 days or less); a longer one is an admin's to lift.
 */
export async function liftSuspension(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireModerator();
  const id = Math.floor(Number(form.get("sanction")));
  if (!Number.isFinite(id)) return fail("noSanction");
  const reason = reasonFrom(form);
  if (!reason) return fail("reasonRequired");

  const result = await sql.begin(async (tx) => {
    const [s] = await tx<{ user_id: string; days: number; lifted_at: Date | null }[]>`
      select user_id, lifted_at,
             ceil(extract(epoch from ends_at - starts_at) / 86400)::int as days
        from forum_sanctions where id = ${id} for update`;
    if (!s || s.lifted_at) return "noSanction";
    if (s.user_id === actor.id) return "cannotSanction";
    if (s.days > maxSuspensionDays("moderator") && actor.role !== "admin") return "adminOnly";
    await tx`
      update forum_sanctions set lifted_at = now(), lifted_by = ${actor.id}::uuid where id = ${id}`;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id, subject_user_id, reason)
      values (${actor.id}::uuid, 'lift', 'user', ${String(id)}, ${s.user_id}::uuid, ${reason})`;
    return null;
  });
  if (result) return fail(result);
  refresh();
  return ok("lifted");
}

/** Admins only: make a member a moderator, or a moderator a member again. */
export async function setMemberRole(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireAdmin();
  const handle = String(form.get("handle") ?? "").trim();
  const next = form.get("role");
  const reason = reasonFrom(form);
  if (!reason) return fail("reasonRequired");

  const result = await sql.begin(async (tx) => {
    const target = await memberByHandle(tx, handle);
    if (!target) return "noMember";
    if (!canSetRole(actor, { id: target.user_id, role: target.role }, next)) return "cannotSetRole";
    await tx`update profiles set role = ${next} where id = ${target.user_id}::uuid`;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id, subject_user_id, reason, detail)
      values (${actor.id}::uuid, 'set_role', 'user', ${handle}, ${target.user_id}::uuid, ${reason},
              ${sql.json({ from: target.role, to: next })})`;
    return null;
  });
  if (result) return fail(result);
  refresh();
  return ok("roleChanged");
}

/* ------------------------------------------------------------------ *
 * Watched words
 * ------------------------------------------------------------------ */

export async function addWatchedWord(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireModerator();
  const word = boundedText(String(form.get("word") ?? "").normalize("NFKC").toLowerCase(), 1, 60);
  if (!word) return fail("wordLength");
  const note = String(form.get("note") ?? "").trim().slice(0, 200) || null;

  const added = await sql.begin(async (tx) => {
    const rows = await tx`
      insert into forum_watched_words (word, note, created_by)
      values (${word}, ${note}, ${actor.id}::uuid)
      on conflict (word) do nothing returning id`;
    if (rows.length === 0) return false;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id, reason)
      values (${actor.id}::uuid, 'word_add', 'word', ${word}, ${note})`;
    return true;
  });
  if (!added) return fail("wordExists");
  refresh();
  return ok("wordAdded");
}

export async function removeWatchedWord(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const actor = await requireModerator();
  const id = Math.floor(Number(form.get("id")));
  if (!Number.isFinite(id)) return fail("noWord");

  const removed = await sql.begin(async (tx) => {
    const [row] = await tx<{ word: string }[]>`
      delete from forum_watched_words where id = ${id} returning word`;
    if (!row) return false;
    await tx`
      insert into forum_mod_actions (actor_id, action, target_type, target_id)
      values (${actor.id}::uuid, 'word_remove', 'word', ${row.word})`;
    return true;
  });
  if (!removed) return fail("noWord");
  refresh();
  return ok("wordRemoved");
}
