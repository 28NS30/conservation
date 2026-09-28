import { sql } from "@/lib/db";
import { forumEnabled } from "@/lib/forum/gate";
import { RETENTION_DAYS } from "@/lib/forum/policy";

/**
 * The forum's retention job: purge what the forum keeps only for a while.
 *
 *   GET  /api/jobs/forum-retention     Authorization: Bearer $CRON_SECRET
 *   POST /api/jobs/forum-retention     Authorization: Bearer $CRON_SECRET
 *
 * Driven by Vercel Cron (apps/web/vercel.json), daily. After RETENTION_DAYS
 * (180) it deletes:
 *
 *   - soft-deleted posts and threads, for good;
 *   - forum_post_meta, the keyed IP hash and user agent kept per post;
 *   - forum_post_revisions, the text moderators edited out — usually exactly
 *     the location that must not be public;
 *   - flags that were resolved;
 *   - the forum's own rate-limit counters, after two days.
 *
 * 180 days because 兒童及少年性剝削防制條例 Art. 8 asks a platform to keep the
 * content, the poster's data and the logs that long after it removes
 * something on notice; keeping them longer than that has no reason. A row
 * under legal hold is skipped by every step, and so is anything in a thread
 * under legal hold: a hold is set by an admin, in SQL, on a legal request.
 *
 * A 404 while the forum is off — checked before the secret, so a switched-off
 * forum answers exactly as a route that does not exist. Each delete is capped
 * per run so a long backlog cannot hold locks for the whole of a request; the
 * next day's run takes the rest.
 */

export const maxDuration = 60;

/** See ../classify/route.ts: a prerendered job would never delete anything. */
export const dynamic = "force-dynamic";

const BATCH = 1000;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** GET because that is the method Vercel Cron sends; POST for a manual run. */
export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}

async function run(req: Request) {
  if (!forumEnabled()) return new Response("Not Found", { status: 404 });
  if (!authorised(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const days = RETENTION_DAYS;
  try {
    const posts = await sql`
      delete from forum_posts p
       where p.id in (
         select p2.id from forum_posts p2
           join forum_threads t on t.id = p2.thread_id
          where p2.status = 'deleted'
            and p2.deleted_at < now() - ${days} * interval '1 day'
            and not p2.legal_hold and not t.legal_hold
          limit ${BATCH})
      returning 1`;
    const threads = await sql`
      delete from forum_threads t
       where t.id in (
         select t2.id from forum_threads t2
          where t2.status = 'deleted'
            and t2.deleted_at < now() - ${days} * interval '1 day'
            and not t2.legal_hold
            and not exists (select 1 from forum_posts p where p.thread_id = t2.id and p.legal_hold)
          limit ${BATCH})
      returning 1`;
    const meta = await sql`
      delete from forum_post_meta m
       where m.post_id in (
         select m2.post_id from forum_post_meta m2
           join forum_posts p on p.id = m2.post_id
          where m2.created_at < now() - ${days} * interval '1 day'
            and not p.legal_hold
          limit ${BATCH})
      returning 1`;
    const revisions = await sql`
      delete from forum_post_revisions r
       where r.id in (
         select r2.id from forum_post_revisions r2
           join forum_posts p on p.id = r2.post_id
          where r2.created_at < now() - ${days} * interval '1 day'
            and not p.legal_hold
          limit ${BATCH})
      returning 1`;
    const flags = await sql`
      delete from forum_flags f
       where f.id in (
         select f2.id from forum_flags f2
          where f2.status <> 'open'
            and f2.resolved_at < now() - ${days} * interval '1 day'
          limit ${BATCH})
      returning 1`;
    const limits = await sql`
      delete from rate_limits
       where key like 'forum:%' and window_start < now() - interval '2 days'
      returning 1`;

    return Response.json(
      {
        posts: posts.length,
        threads: threads.length,
        meta: meta.length,
        revisions: revisions.length,
        flags: flags.length,
        rateLimits: limits.length,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("[forum-retention]", e);
    return Response.json({ error: "purge_failed" }, { status: 500 });
  }
}
