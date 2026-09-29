import "server-only";

import { sql } from "@/lib/db";
import type { ForumRole } from "./policy";
import type { HoldReason } from "./screen";

/**
 * Reads for the moderation console. The caller has checked the role; these
 * run on the server's own connection because they read what the public
 * cannot: held posts, flags and their notes, sanctions, the audit log.
 *
 * People appear by nickname handle, account age and history only. There is no
 * email here and no join to auth.users: student moderators may know the
 * people they moderate, and a queue that showed addresses would turn a
 * moderation decision into a personal one.
 */

export type QueueFlag = {
  id: number;
  reason: string;
  note: string | null;
  reporter_handle: string | null;
  created_at: Date;
};

export type QueueItem = {
  post_id: string;
  thread_id: string;
  thread_title: string;
  thread_status: string;
  category_slug: string;
  is_opener: boolean;
  body: string;
  status: "visible" | "held" | "hidden" | "deleted";
  held_reasons: HoldReason[];
  created_at: Date;
  author_handle: string | null;
  author_role: ForumRole | null;
  /** Never sent to the browser: the page turns it into `mine` and drops it. */
  author_id: string | null;
  author_days: number | null;
  author_sanctions: number;
  flags: QueueFlag[];
  revisions: number;
};

/**
 * Built per call, not held at module scope: a postgres.js query object is a
 * promise, and see lib/schemaStatus.ts for what reusing one does.
 */
const itemColumns = () => sql`
  p.id as post_id, p.thread_id, t.title as thread_title, t.status as thread_status,
  c.slug as category_slug, p.is_opener, p.body, p.status, p.held_reasons, p.created_at,
  fp.handle as author_handle, pr.role as author_role, p.author_id,
  floor(extract(epoch from now() - fp.created_at) / 86400)::int as author_days,
  (select count(*)::int from forum_sanctions s where s.user_id = p.author_id) as author_sanctions,
  coalesce((select json_agg(json_build_object(
              'id', f.id, 'reason', f.reason, 'note', f.note,
              'reporter_handle', rf.handle, 'created_at', f.created_at) order by f.created_at)
              from forum_flags f
              left join forum_profiles rf on rf.user_id = f.reporter_id
             where f.post_id = p.id and f.status = 'open'), '[]') as flags,
  (select count(*)::int from forum_post_revisions r where r.post_id = p.id) as revisions`;

/** Posts waiting for a decision because a filter or the first-post rule held them. */
export async function heldQueue(): Promise<QueueItem[]> {
  return sql<QueueItem[]>`
    select ${itemColumns()}
      from forum_posts p
      join forum_threads t on t.id = p.thread_id
      join forum_categories c on c.id = t.category_id
      left join forum_profiles fp on fp.user_id = p.author_id
      left join profiles pr on pr.id = p.author_id
     where p.status = 'held'
       and not ('flagged' = any(p.held_reasons))
     order by p.created_at
     limit 100`;
}

/**
 * Posts with open flags, the urgent reasons first: a flagged location or a
 * safety concern is read before spam.
 */
export async function flaggedQueue(): Promise<QueueItem[]> {
  return sql<QueueItem[]>`
    select ${itemColumns()}
      from forum_posts p
      join forum_threads t on t.id = p.thread_id
      join forum_categories c on c.id = t.category_id
      left join forum_profiles fp on fp.user_id = p.author_id
      left join profiles pr on pr.id = p.author_id
     where exists (select 1 from forum_flags f where f.post_id = p.id and f.status = 'open')
       and p.status <> 'deleted'
     order by exists (select 1 from forum_flags f
                       where f.post_id = p.id and f.status = 'open'
                         and f.reason in ('sensitive_location', 'personal_info', 'safety')) desc,
              p.created_at
     limit 100`;
}

export async function queueCounts(): Promise<{ held: number; flagged: number }> {
  const [row] = await sql<{ held: number; flagged: number }[]>`
    select (select count(*)::int from forum_posts where status = 'held') as held,
           (select count(distinct post_id)::int from forum_flags where status = 'open') as flagged`;
  return row;
}

export type AuditRow = {
  id: number;
  created_at: Date;
  actor_handle: string | null;
  action: string;
  target_type: string;
  target_id: string;
  subject_handle: string | null;
  reason: string | null;
};

export async function auditLog(limit = 100): Promise<AuditRow[]> {
  return sql<AuditRow[]>`
    select a.id, a.created_at, af.handle as actor_handle, a.action, a.target_type,
           a.target_id, sf.handle as subject_handle, a.reason
      from forum_mod_actions a
      left join forum_profiles af on af.user_id = a.actor_id
      left join forum_profiles sf on sf.user_id = a.subject_user_id
     order by a.created_at desc, a.id desc
     limit ${limit}`;
}

export type SuspensionRow = {
  id: number;
  handle: string | null;
  starts_at: Date;
  ends_at: Date;
  reason: string;
  actor_handle: string | null;
  days: number;
};

export async function activeSuspensions(): Promise<SuspensionRow[]> {
  return sql<SuspensionRow[]>`
    select s.id, fp.handle, s.starts_at, s.ends_at, s.reason, af.handle as actor_handle,
           ceil(extract(epoch from s.ends_at - s.starts_at) / 86400)::int as days
      from forum_sanctions s
      left join forum_profiles fp on fp.user_id = s.user_id
      left join forum_profiles af on af.user_id = s.actor_id
     where s.lifted_at is null and s.ends_at > now()
     order by s.ends_at`;
}

export type WordRow = { id: number; word: string; note: string | null };

export async function watchedWordList(): Promise<WordRow[]> {
  return sql<WordRow[]>`select id, word, note from forum_watched_words order by word`;
}

export type RoleRow = { handle: string | null; role: ForumRole };

/** Everyone holding a role, by nickname. Admins see this to manage moderators. */
export async function roleHolders(): Promise<RoleRow[]> {
  return sql<RoleRow[]>`
    select fp.handle, pr.role
      from profiles pr
      left join forum_profiles fp on fp.user_id = pr.id
     where pr.role in ('moderator', 'admin')
     order by pr.role, fp.handle nulls last`;
}
