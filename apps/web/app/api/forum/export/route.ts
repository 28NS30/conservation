import { sql } from "@/lib/db";
import { forumEnabled } from "@/lib/forum/gate";
import { currentUserId } from "@/lib/supabase/server";

/**
 * "Export my posts": everything the signed-in member has written in the
 * forum, as a JSON file.
 *
 * 個人資料保護法 Art. 3 gives a person the right to a copy of their data. This
 * is that copy for the forum, self-service, from /me. It holds what the member
 * gave us and what we decided about it — their profile, every post in every
 * status with its thread's title, the flags they raised and the votes they
 * cast — and nothing about anyone else: not who flagged them, not a moderator's identity, not
 * the IP hashes, which are kept only for abuse and legal requests.
 *
 * Scoped by the session's user id and nothing else; there is no parameter to
 * change whose posts come back. A 404 while the forum is off, before anything
 * else is looked at.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!forumEnabled()) return new Response("Not Found", { status: 404 });

  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "sign_in_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  const [profile] = await sql`
    select handle, age_band, guardian_ack_at, guidelines_version, guidelines_accepted_at, created_at as joined_at
      from forum_profiles where user_id = ${userId}::uuid`;
  const posts = await sql`
    select p.id, p.thread_id, t.title as thread_title, p.is_opener, p.body, p.status,
           p.held_reasons, p.moderator_note, p.edited_by_moderator, p.edited_at,
           p.created_at, p.deleted_at
      from forum_posts p
      join forum_threads t on t.id = p.thread_id
     where p.author_id = ${userId}::uuid
     order by p.created_at`;
  const flags = await sql`
    select f.post_id, f.reason, f.note, f.status, f.created_at
      from forum_flags f
     where f.reporter_id = ${userId}::uuid
     order by f.created_at`;
  // Their own votes: nobody else ever sees one, but they are theirs to see.
  const votes = await sql`
    select v.post_id, p.thread_id, v.value, v.created_at, v.updated_at
      from forum_votes v
      join forum_posts p on p.id = v.post_id
     where v.voter_id = ${userId}::uuid
     order by v.created_at`;

  const now = new Date();
  const body = JSON.stringify(
    { exportedAt: now.toISOString(), profile: profile ?? null, posts, flags, votes },
    null,
    2,
  );
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="community-posts-${now.toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
