import "server-only";

import { asPublic, sql } from "@/lib/db";
import { POSTS_PER_PAGE, THREADS_PER_PAGE } from "./policy";
import type { HoldReason } from "./screen";

/**
 * Reads for the forum's pages.
 *
 * THE RULE. Anything a visitor may see is read through `asPublic()` — as the
 * `web_anon` role, from the *_public views — so a page that asks for too much
 * fails with "permission denied" instead of showing it. The only reads on the
 * server's own connection are these, each bound to the session's user id or
 * to a moderator's role, which the caller has already checked:
 *
 *   - a member's own held, hidden or deleted posts and threads, so they can
 *     see that a post is waiting and why;
 *   - everything, for a moderator, who has to read what they are deciding on.
 *
 * Nothing here selects an email address, and nothing returns an author's user
 * id to a page: people are their nickname handle and nothing else.
 */

export type Category = {
  id: number;
  slug: string;
  name_zh: string;
  name_en: string;
  description_zh: string;
  description_en: string;
  sort: number;
  moderators_only_post: boolean;
  thread_count: number;
  post_count: number;
  last_activity_at: Date | null;
};

export async function listCategories(): Promise<Category[]> {
  return asPublic((tx) => tx<Category[]>`
    select * from forum_categories_public order by sort, id`);
}

export async function categoryBySlug(slug: string): Promise<Category | null> {
  const [row] = await asPublic((tx) => tx<Category[]>`
    select * from forum_categories_public where slug = ${slug}`);
  return row ?? null;
}

export type ThreadStatus = "visible" | "held" | "hidden" | "deleted";

export type ThreadRow = {
  id: string;
  category_id: number;
  category_slug: string;
  title: string;
  locked: boolean;
  pinned_at: Date | null;
  created_at: Date;
  last_activity_at: Date;
  reply_count: number;
  author_handle: string | null;
  /** 'visible' for everything read through the public view. */
  status: ThreadStatus;
};

/** One page of a category's public threads: pinned first, then newest activity. */
export async function listThreads(
  categoryId: number,
  offset: number,
): Promise<{ rows: ThreadRow[]; total: number }> {
  return asPublic(async (tx) => {
    const rows = await tx<ThreadRow[]>`
      select *, 'visible' as status from forum_threads_public
       where category_id = ${categoryId}
       order by pinned_at desc nulls last, last_activity_at desc, id
       limit ${THREADS_PER_PAGE} offset ${offset}`;
    const [{ n }] = await tx<{ n: number }[]>`
      select count(*)::int as n from forum_threads_public where category_id = ${categoryId}`;
    return { rows, total: n };
  });
}

/** The viewer's own threads in a category that the public cannot see yet. */
export async function ownUnpublishedThreads(categoryId: number, userId: string): Promise<ThreadRow[]> {
  return sql<ThreadRow[]>`
    select t.id, t.category_id, c.slug as category_slug, t.title, t.locked, t.pinned_at,
           t.created_at, t.last_activity_at, t.visible_reply_count as reply_count,
           fp.handle as author_handle, t.status
      from forum_threads t
      join forum_categories c on c.id = t.category_id
      left join forum_profiles fp on fp.user_id = t.author_id
     where t.category_id = ${categoryId}
       and t.author_id = ${userId}::uuid
       and t.status in ('held', 'hidden')
     order by t.created_at desc
     limit 20`;
}

export type ThreadDetail = ThreadRow & { category_name_zh: string; category_name_en: string };

/**
 * A thread, as this viewer may see it.
 *
 * The public view first. If it is not there, the thread is either missing or
 * not public, and the server connection is asked only on behalf of its author
 * (held or hidden, never deleted) or a moderator. Anyone else gets null, which
 * the page turns into a 404: a held thread does not exist to the public, not
 * even as a title.
 */
export async function threadForViewer(
  id: string,
  viewer: { userId: string | null; isModerator: boolean },
): Promise<ThreadDetail | null> {
  if (!isUuid(id)) return null;
  const [pub] = await asPublic((tx) => tx<ThreadDetail[]>`
    select t.*, 'visible' as status, c.name_zh as category_name_zh, c.name_en as category_name_en
      from forum_threads_public t
      join forum_categories_public c on c.id = t.category_id
     where t.id = ${id}::uuid`);
  if (pub) return pub;
  if (!viewer.userId) return null;

  const [row] = await sql<(ThreadDetail & { author_id: string | null })[]>`
    select t.id, t.category_id, c.slug as category_slug, t.title, t.locked, t.pinned_at,
           t.created_at, t.last_activity_at, t.visible_reply_count as reply_count,
           fp.handle as author_handle, t.status, t.author_id,
           c.name_zh as category_name_zh, c.name_en as category_name_en
      from forum_threads t
      join forum_categories c on c.id = t.category_id
      left join forum_profiles fp on fp.user_id = t.author_id
     where t.id = ${id}::uuid`;
  if (!row) return null;
  const own = row.author_id === viewer.userId && (row.status === "held" || row.status === "hidden");
  if (!own && !viewer.isModerator) return null;
  const { author_id: _omit, ...rest } = row;
  return rest;
}

export type PostRow = {
  id: string;
  thread_id: string;
  is_opener: boolean;
  body: string;
  created_at: Date;
  edited_at: Date | null;
  edited_by_moderator: boolean;
  author_handle: string | null;
  author_is_moderator: boolean;
  status: ThreadStatus;
  held_reasons: HoldReason[];
  moderator_note: string | null;
  /** Whether the viewer wrote it: for "delete my post" and "awaiting review". */
  mine: boolean;
};

/**
 * A page of a thread's posts for this viewer: the public ones, plus the
 * viewer's own posts that are waiting or were hidden (so they can see why), or
 * every post for a moderator.
 */
export async function postsForViewer(
  threadId: string,
  offset: number,
  viewer: { userId: string | null; isModerator: boolean },
): Promise<{ rows: PostRow[]; total: number }> {
  if (viewer.isModerator) {
    const rows = await sql<PostRow[]>`
      select p.id, p.thread_id, p.is_opener, p.body, p.created_at, p.edited_at,
             p.edited_by_moderator, fp.handle as author_handle,
             coalesce(pr.role in ('moderator', 'admin'), false) as author_is_moderator,
             p.status, p.held_reasons, p.moderator_note,
             (p.author_id is not distinct from ${viewer.userId}::uuid) as mine
        from forum_posts p
        left join forum_profiles fp on fp.user_id = p.author_id
        left join profiles pr on pr.id = p.author_id and fp.user_id is not null
       where p.thread_id = ${threadId}::uuid
       order by p.created_at, p.id
       limit ${POSTS_PER_PAGE} offset ${offset}`;
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from forum_posts where thread_id = ${threadId}::uuid`;
    return { rows, total: n };
  }

  const publicRows = await asPublic((tx) => tx<PostRow[]>`
    select id, thread_id, is_opener, body, created_at, edited_at, edited_by_moderator,
           author_handle, author_is_moderator,
           'visible' as status, '{}'::text[] as held_reasons, null as moderator_note,
           false as mine
      from forum_posts_public
     where thread_id = ${threadId}::uuid`);

  let own: (PostRow & { id: string })[] = [];
  const mineIds = new Set<string>();
  if (viewer.userId) {
    own = await sql<PostRow[]>`
      select p.id, p.thread_id, p.is_opener, p.body, p.created_at, p.edited_at,
             p.edited_by_moderator, fp.handle as author_handle, false as author_is_moderator,
             p.status, p.held_reasons, p.moderator_note, true as mine
        from forum_posts p
        left join forum_profiles fp on fp.user_id = p.author_id
       where p.thread_id = ${threadId}::uuid
         and p.author_id = ${viewer.userId}::uuid
         and p.status <> 'deleted'`;
    for (const r of own) mineIds.add(r.id);
  }

  // The viewer's own rows replace their public twins (same post, with
  // `mine` set), and add the ones the public cannot see.
  const merged = new Map<string, PostRow>();
  for (const r of publicRows) merged.set(r.id, r);
  for (const r of own) {
    const pub = merged.get(r.id);
    merged.set(r.id, pub ? { ...pub, mine: true } : r);
  }
  const all = [...merged.values()].sort(
    (a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id),
  );
  return { rows: all.slice(offset, offset + POSTS_PER_PAGE), total: all.length };
}

export type PublicProfile = {
  handle: string;
  nickname_key: string;
  nickname_no: number;
  joined_month: Date;
  is_moderator: boolean;
  post_count: number;
};

export async function profileByHandle(handle: string): Promise<PublicProfile | null> {
  const [row] = await asPublic((tx) => tx<PublicProfile[]>`
    select * from forum_profiles_public where handle = ${handle}`);
  return row ?? null;
}

export type ProfilePost = {
  id: string;
  thread_id: string;
  thread_title: string;
  body: string;
  created_at: Date;
};

export async function recentPostsByHandle(handle: string): Promise<ProfilePost[]> {
  return asPublic((tx) => tx<ProfilePost[]>`
    select p.id, p.thread_id, t.title as thread_title, p.body, p.created_at
      from forum_posts_public p
      join forum_threads_public t on t.id = p.thread_id
     where p.author_handle = ${handle}
     order by p.created_at desc
     limit 20`);
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
