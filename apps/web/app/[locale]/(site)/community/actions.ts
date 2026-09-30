"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { sql } from "@/lib/db";
import { withinRateLimit } from "@/lib/abuse";
import { forumViewer, moderatorCount, requestFingerprint, requireForum, watchedWords, type ForumViewer } from "@/lib/forum/server";
import { parseHandle } from "@/lib/forum/nickname";
import { firstPostsNeedReview, screenText, type HoldReason } from "@/lib/forum/screen";
import {
  BODY_MAX,
  BODY_MIN,
  FLAGS_TO_HIDE,
  GUIDELINES_VERSION,
  NOTE_MAX,
  TITLE_MAX,
  TITLE_MIN,
  boundedText,
  flagHidesAtOnce,
  isFlagReason,
  joinDecision,
  parseVote,
  postingLimits,
  voteRefusal,
} from "@/lib/forum/policy";
import { isUuid } from "@/lib/forum/queries";
import { fail, ok, type ActionResult } from "@/lib/forum/result";

/**
 * What a member can do: join, post, reply, vote, flag, delete their own words,
 * leave.
 *
 * Every export starts with `requireForum()`, which answers 404 while the forum
 * is switched off, and then reads who is asking from the session — never from
 * the form. A server action is a public POST endpoint reachable from any page
 * on the site, whatever the page that rendered its form checked.
 * test/forum-gate.test.mjs holds both rules for every export in this file.
 *
 * The moderator's actions live in ./moderation/actions.ts, behind their own
 * role check.
 */

/** Set when someone says they are under 13, so the answer cannot just be changed and resent. */
const AGE_REFUSED_COOKIE = "forum_age_refused";

/** Why this person cannot post right now, or null if they can. */
function postingBlock(viewer: ForumViewer): string | null {
  if (!viewer.userId) return "signIn";
  if (!viewer.member) return "joinFirst";
  if (viewer.member.guidelinesVersion < GUIDELINES_VERSION) return "guidelinesChanged";
  if (viewer.suspendedUntil) return "suspended";
  return null;
}

/** All three budgets, spent together; any one over its limit refuses the post. */
async function withinPostingBudget(userId: string, newAccount: boolean, thread: boolean): Promise<boolean> {
  const limits = postingLimits(newAccount);
  const checks = [
    withinRateLimit(`forum:burst:${userId}`, limits.burst.windowSeconds, limits.burst.budget),
    withinRateLimit(`forum:posts:${userId}`, limits.postsPerDay.windowSeconds, limits.postsPerDay.budget),
  ];
  if (thread)
    checks.push(
      withinRateLimit(`forum:threads:${userId}`, limits.threadsPerDay.windowSeconds, limits.threadsPerDay.budget),
    );
  return (await Promise.all(checks)).every(Boolean);
}

/**
 * Screen a new post and decide whether it waits for a moderator.
 *
 * The title is screened with the body, because a title can carry a location
 * as easily as the text under it.
 */
async function holdReasons(viewer: ForumViewer, text: string): Promise<HoldReason[]> {
  const [words, mods, [{ n: prior }]] = await Promise.all([
    watchedWords(),
    moderatorCount(),
    // Posts of theirs that are out: approved, or never held. Every post
    // counted, and two waiting in the queue or deleted by their author were
    // enough to switch review off (security audit, 29 September 2026).
    sql<{ n: number }[]>`
      select count(*)::int as n from forum_posts
       where author_id = ${viewer.userId}::uuid and status = 'visible'`,
  ]);
  const { reasons } = screenText(text, { watchedWords: words, newAccount: viewer.member!.newAccount });
  if (
    firstPostsNeedReview({
      priorPosts: prior,
      moderatorCount: mods,
      override: process.env.FORUM_REVIEW_FIRST_POSTS,
    })
  )
    reasons.push("first_posts");
  return reasons;
}

/* ------------------------------------------------------------------ *
 * Joining
 * ------------------------------------------------------------------ */

export async function joinForum(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const viewer = await forumViewer();
  if (!viewer.userId) return fail("signIn");
  if (viewer.member) return fail("alreadyJoined");

  const store = await cookies();
  if (store.get(AGE_REFUSED_COOKIE)) return fail("tooYoung");

  const decision = joinDecision(form.get("ageBand"), form.get("guardian") === "on");
  if (!decision.ok) {
    if (decision.error === "tooYoung") {
      // Nothing about the person is stored — not their answer, not a row. The
      // cookie only stops the same browser changing the answer and trying
      // again straight away, which is what a neutral age question needs.
      store.set(AGE_REFUSED_COOKIE, "1", {
        maxAge: 60 * 60 * 24,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    }
    return fail(decision.error);
  }
  if (form.get("guidelines") !== "on") return fail("acceptGuidelines");

  // Only a name the generator could have made: see parseHandle().
  const nickname = parseHandle(form.get("nickname"));
  if (!nickname) return fail("badNickname");

  try {
    await sql.begin(async (tx) => {
      // The row every account should already have. On a database with
      // Supabase Auth a trigger creates it at sign-up; this covers one where
      // it did not, and is a no-op otherwise.
      await tx`insert into profiles (id) values (${viewer.userId}::uuid) on conflict (id) do nothing`;
      await tx`
        insert into forum_profiles
          (user_id, nickname_key, nickname_no, age_band, guardian_ack_at,
           guidelines_version, guidelines_accepted_at)
        values (${viewer.userId}::uuid, ${nickname.key}, ${nickname.no}, ${decision.ageBand},
                ${decision.ageBand === "13_17" ? new Date() : null},
                ${GUIDELINES_VERSION}, now())
        on conflict (user_id) do nothing`;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return fail("nicknameTaken");
    throw e;
  }

  redirect({ href: "/community", locale: await getLocale() });
  return null;
}

/** Accept a new version of the guidelines, when they have changed since joining. */
export async function acceptGuidelines(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const viewer = await forumViewer();
  if (!viewer.userId) return fail("signIn");
  if (!viewer.member) return fail("joinFirst");
  if (form.get("guidelines") !== "on") return fail("acceptGuidelines");
  await sql`
    update forum_profiles
       set guidelines_version = ${GUIDELINES_VERSION}, guidelines_accepted_at = now()
     where user_id = ${viewer.userId}::uuid`;
  refresh();
  return ok("guidelinesAccepted");
}

/* ------------------------------------------------------------------ *
 * Posting
 * ------------------------------------------------------------------ */

export async function createThread(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const viewer = await forumViewer();
  const blocked = postingBlock(viewer);
  if (blocked) return fail(blocked);

  const [category] = await sql<{ id: number; moderators_only_post: boolean }[]>`
    select id, moderators_only_post from forum_categories
     where slug = ${String(form.get("category") ?? "")} and not archived`;
  if (!category) return fail("noCategory");
  if (category.moderators_only_post && !viewer.isModerator) return fail("moderatorsOnly");

  const title = boundedText(form.get("title"), TITLE_MIN, TITLE_MAX);
  if (!title) return fail("titleLength");
  const body = boundedText(form.get("body"), BODY_MIN, BODY_MAX);
  if (!body) return fail("bodyLength");

  if (!(await withinPostingBudget(viewer.userId!, viewer.member!.newAccount, true))) return fail("tooFast");

  const reasons = await holdReasons(viewer, `${title}\n${body}`);
  const status = reasons.length ? "held" : "visible";
  const meta = await requestFingerprint();

  const threadId = await sql.begin(async (tx) => {
    const [thread] = await tx<{ id: string }[]>`
      insert into forum_threads (category_id, author_id, title, status)
      values (${category.id}, ${viewer.userId}::uuid, ${title}, ${status})
      returning id`;
    const [post] = await tx<{ id: string }[]>`
      insert into forum_posts (thread_id, author_id, is_opener, body, status, held_reasons)
      values (${thread.id}::uuid, ${viewer.userId}::uuid, true, ${body}, ${status}, ${reasons}::text[])
      returning id`;
    await tx`
      insert into forum_post_meta (post_id, author_id, ip_hash, user_agent)
      values (${post.id}::uuid, ${viewer.userId}::uuid, ${meta.ipHash}, ${meta.userAgent})`;
    return thread.id;
  });

  // The thread page explains a hold itself, from the post's own reasons, so
  // the poster lands on their thread either way.
  redirect({ href: `/community/t/${threadId}`, locale: await getLocale() });
  return null;
}

/**
 * Reply to a thread, or, with `parent`, to a reply in it.
 *
 * A reply answers only what its writer can see and everyone else can too: a
 * visible post, in this thread. The opening post is the thread itself, so an
 * answer to it is a top-level reply. Where the reply sits in the tree is the
 * database's to decide (migration 0030, forum_place_reply), and it is
 * screened, held, rate-limited and moderated exactly as any other post.
 */
export async function replyToThread(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const viewer = await forumViewer();
  const blocked = postingBlock(viewer);
  if (blocked) return fail(blocked);

  const threadId = String(form.get("thread") ?? "");
  if (!isUuid(threadId)) return fail("noThread");
  const [thread] = await sql<{ status: string; locked: boolean }[]>`
    select status, locked from forum_threads where id = ${threadId}::uuid`;
  if (!thread || thread.status !== "visible") return fail("noThread");
  if (thread.locked && !viewer.isModerator) return fail("locked");

  let parentId: string | null = null;
  const rawParent = String(form.get("parent") ?? "");
  if (rawParent) {
    if (!isUuid(rawParent)) return fail("noParent");
    const [parent] = await sql<{ status: string; is_opener: boolean }[]>`
      select status, is_opener from forum_posts
       where id = ${rawParent}::uuid and thread_id = ${threadId}::uuid`;
    if (!parent || parent.status !== "visible") return fail("noParent");
    parentId = parent.is_opener ? null : rawParent;
  }

  const body = boundedText(form.get("body"), BODY_MIN, BODY_MAX);
  if (!body) return fail("bodyLength");

  if (!(await withinPostingBudget(viewer.userId!, viewer.member!.newAccount, false))) return fail("tooFast");

  const reasons = await holdReasons(viewer, body);
  const status = reasons.length ? "held" : "visible";
  const meta = await requestFingerprint();

  await sql.begin(async (tx) => {
    const [post] = await tx<{ id: string }[]>`
      insert into forum_posts (thread_id, author_id, parent_id, body, status, held_reasons)
      values (${threadId}::uuid, ${viewer.userId}::uuid, ${parentId}::uuid, ${body}, ${status}, ${reasons}::text[])
      returning id`;
    await tx`
      insert into forum_post_meta (post_id, author_id, ip_hash, user_agent)
      values (${post.id}::uuid, ${viewer.userId}::uuid, ${meta.ipHash}, ${meta.userAgent})`;
  });

  refresh();
  return status === "held" ? ok("held", reasons) : ok("posted");
}

/**
 * Vote a post up or down, change the vote, or take it back (value 0).
 *
 * A vote on a thread is a vote on its opening post. Members only, on the
 * current guidelines and not suspended, as for posting; never on your own
 * post, on anything the public cannot see, or in a locked thread
 * (voteRefusal). The score is kept by the database in the same transaction
 * (migration 0030), which also refuses the first two on its own.
 *
 * The author of record comes from the post's metadata when the post has lost
 * it, as it does for review (moderation/actions.ts POST_AUTHOR): leaving and
 * rejoining must not let anyone vote for their own words.
 */
export async function votePost(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const viewer = await forumViewer();
  const blocked = postingBlock(viewer);
  if (blocked) return fail(blocked);

  const postId = String(form.get("post") ?? "");
  if (!isUuid(postId)) return fail("noPost");
  const value = parseVote(form.get("value"));
  if (value === null) return fail("voteInvalid");
  const takeBack = value === 0;

  const limits = postingLimits(viewer.member!.newAccount);
  const within = await Promise.all([
    withinRateLimit(`forum:votes:${viewer.userId}`, limits.votesBurst.windowSeconds, limits.votesBurst.budget),
    withinRateLimit(`forum:votes-day:${viewer.userId}`, limits.votesPerDay.windowSeconds, limits.votesPerDay.budget),
  ]);
  if (!within.every(Boolean)) return fail("tooManyVotes");

  const result = await sql.begin(async (tx) => {
    const [post] = await tx<
      { author_id: string | null; status: string; thread_status: string; locked: boolean; archived: boolean }[]
    >`
      select coalesce(p.author_id,
               (select pm.author_id from forum_post_meta pm where pm.post_id = p.id)) as author_id,
             p.status, t.status as thread_status, t.locked, c.archived
        from forum_posts p
        join forum_threads t on t.id = p.thread_id
        join forum_categories c on c.id = t.category_id
       where p.id = ${postId}::uuid`;
    const refused = voteRefusal(
      post && {
        own: post.author_id === viewer.userId,
        status: post.status,
        threadStatus: post.thread_status,
        locked: post.locked,
        archived: post.archived,
      },
    );
    if (refused) return refused;

    if (takeBack)
      await tx`delete from forum_votes where post_id = ${postId}::uuid and voter_id = ${viewer.userId}::uuid`;
    else
      await tx`
        insert into forum_votes (post_id, voter_id, value)
        values (${postId}::uuid, ${viewer.userId}::uuid, ${value})
        on conflict (post_id, voter_id) do update
           set value = excluded.value, updated_at = now()
         where forum_votes.value <> excluded.value`;
    return null;
  });
  if (result) return fail(result);

  refresh();
  return ok(takeBack ? "voteRemoved" : "voted");
}

/**
 * Delete one of your own posts. Soft, like every delete here: the text leaves
 * the forum at once and is purged after the retention period.
 *
 * An opening post takes its thread with it, which would let one person erase
 * everyone else's replies — so once others have replied, that is a moderator's
 * decision rather than the author's.
 */
export async function deleteOwnPost(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const viewer = await forumViewer();
  if (!viewer.userId) return fail("signIn");

  const postId = String(form.get("post") ?? "");
  if (!isUuid(postId)) return fail("noPost");

  const result = await sql.begin(async (tx) => {
    const [post] = await tx<{ author_id: string | null; is_opener: boolean; thread_id: string; status: string }[]>`
      select author_id, is_opener, thread_id, status from forum_posts
       where id = ${postId}::uuid for update`;
    if (!post || post.status === "deleted") return "noPost";
    if (post.author_id !== viewer.userId) return "notYours";
    if (post.is_opener) {
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int as n from forum_posts
         where thread_id = ${post.thread_id}::uuid and not is_opener and status <> 'deleted'
           and author_id is distinct from ${viewer.userId}::uuid`;
      if (n > 0) return "threadHasReplies";
      await tx`update forum_threads set status = 'deleted', deleted_at = now()
                where id = ${post.thread_id}::uuid`;
    }
    await tx`update forum_posts set status = 'deleted', deleted_at = now()
              where id = ${postId}::uuid`;
    return null;
  });
  if (result) return fail(result);

  refresh();
  return ok("deleted");
}

/**
 * Flag a post for a moderator.
 *
 * One flag for a sensitive location, personal information or a safety concern
 * takes the post out of public view at once, pending review. A wrong hide
 * costs a post a short wait; a location left up cannot be taken back. Spam and
 * "other" take three people.
 */
export async function flagPost(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const viewer = await forumViewer();
  if (!viewer.userId) return fail("signIn");
  if (!viewer.member) return fail("joinFirst");
  if (viewer.suspendedUntil) return fail("suspended");

  const postId = String(form.get("post") ?? "");
  if (!isUuid(postId)) return fail("noPost");
  const reason = form.get("reason");
  if (!isFlagReason(reason)) return fail("chooseReason");
  const rawNote = String(form.get("note") ?? "").trim();
  const note = rawNote ? boundedText(rawNote, 1, NOTE_MAX) : null;
  if (rawNote && !note) return fail("noteLength");

  const limits = postingLimits(viewer.member.newAccount);
  if (!(await withinRateLimit(`forum:flags:${viewer.userId}`, limits.flagsPerDay.windowSeconds, limits.flagsPerDay.budget)))
    return fail("tooManyFlags");

  const result = await sql.begin(async (tx) => {
    const [post] = await tx<{ author_id: string | null; status: string; is_opener: boolean; thread_id: string }[]>`
      select author_id, status, is_opener, thread_id from forum_posts
       where id = ${postId}::uuid for update`;
    if (!post || post.status === "deleted") return "noPost";
    if (post.author_id === viewer.userId) return "ownPost";

    const inserted = await tx`
      insert into forum_flags (post_id, reporter_id, reason, note)
      values (${postId}::uuid, ${viewer.userId}::uuid, ${reason}, ${note})
      on conflict (post_id, reporter_id) do nothing
      returning id`;
    if (inserted.length === 0) return "alreadyFlagged";

    const [{ n }] = await tx<{ n: number }[]>`
      select count(distinct reporter_id)::int as n from forum_flags
       where post_id = ${postId}::uuid and status = 'open'`;
    if (post.status === "visible" && (flagHidesAtOnce(reason) || n >= FLAGS_TO_HIDE)) {
      await tx`
        update forum_posts
           set status = 'held',
               held_reasons = array_append(array_remove(held_reasons, 'flagged'), 'flagged')
         where id = ${postId}::uuid`;
      if (post.is_opener)
        await tx`update forum_threads set status = 'held' where id = ${post.thread_id}::uuid`;
    }
    return null;
  });
  if (result === "alreadyFlagged") return ok("alreadyFlagged");
  if (result) return fail(result);

  refresh();
  return ok("flagged");
}

/* ------------------------------------------------------------------ *
 * Leaving
 * ------------------------------------------------------------------ */

/**
 * Delete my forum account.
 *
 * Removes the forum profile. Posts and threads stay, as "deleted member":
 * other people's replies to them would make no sense otherwise, and the
 * foreign keys (migration 0019) set their author to null in the same
 * statement. The site account itself, and any reports filed with it, are
 * untouched — this is leaving the forum, not the site.
 *
 * The restricted per-post record of who posted from where is kept until the
 * retention job purges it at 180 days, for the reason given in docs/forum.md.
 */
export async function leaveForum(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  requireForum();
  const viewer = await forumViewer();
  if (!viewer.userId) return fail("signIn");
  if (!viewer.member) return fail("joinFirst");
  if (form.get("confirm") !== "on") return fail("confirmLeave");

  await sql`delete from forum_profiles where user_id = ${viewer.userId}::uuid`;
  refresh();
  return ok("left");
}
