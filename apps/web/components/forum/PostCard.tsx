import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ForumViewer } from "@/lib/forum/server";
import type { PostRow, ThreadDetail } from "@/lib/forum/queries";
import type { ReplyNode } from "@/lib/forum/tree";
import { displayHandle } from "@/lib/forum/nickname";
import { voteRefusal } from "@/lib/forum/policy";
import { LOCATION_REASONS } from "@/lib/forum/screen";
import Nickname from "./Nickname";
import { ReplyComposer } from "./Composer";
import { DeleteOwnForm, FlagForm } from "./PostActions";
import { ModeratePost } from "./ModTools";
import VoteControl from "./VoteControl";
import { btnQuiet, link } from "./styles";

/**
 * One post on a thread's page, opening post or reply, and the tree of
 * replies under a thread.
 *
 * WHO SEES WHAT is the thread page's (see its note): this draws what it is
 * given. Held, hidden and deleted posts reach here only for their author or a
 * moderator, marked with why; everyone else is given a "[removed]" place
 * instead (lib/forum/tree.ts).
 *
 * Post text is rendered as text. React escapes it, so `<script>` shows as the
 * word "<script>", and there is no markdown and no auto-linking: a pasted
 * image URL stays a line of text, never a picture.
 */

export type ThreadContext = {
  thread: ThreadDetail;
  viewer: ForumViewer;
  locale: string;
  /** The viewer's own votes, by post. */
  votes: Map<string, 1 | -1>;
  /** Every post the viewer may see, by id: for "replying to …". */
  byId: Map<string, PostRow>;
};

/** Whether the viewer may answer this post, which is a reply under it. */
function mayReplyTo(p: PostRow, { thread, viewer }: ThreadContext) {
  return (
    viewer.canPost &&
    thread.status === "visible" &&
    p.status === "visible" &&
    (!thread.locked || viewer.isModerator)
  );
}

export async function PostCard({
  post: p,
  ctx,
  replyable = true,
}: {
  post: PostRow;
  ctx: ThreadContext;
  /** False for the opening post, which the reply box under it answers. */
  replyable?: boolean;
}) {
  const { thread, viewer, locale, votes } = ctx;
  const [t, tr, format] = await Promise.all([getTranslations("forum"), getTranslations("forum.reason"), getFormatter()]);
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const byId = `post-${p.id}-by`;

  // On the last level a reply sits beside what it answers; say what that was.
  const beside = p.parent_id !== null && p.path.at(-1) !== p.parent_id;
  const answered = beside ? ctx.byId.get(p.parent_id!) : undefined;
  const answering = !beside
    ? null
    : answered
      ? t("replyingTo", { name: displayHandle(answered.author_handle, locale) ?? t("deletedMember") })
      : t("replyingToRemoved");

  const canVote =
    viewer.canPost &&
    voteRefusal({
      own: p.mine,
      status: p.status,
      threadStatus: thread.status,
      locked: thread.locked,
      archived: false,
    }) === null;

  return (
    <article
      id={`post-${p.id}`}
      aria-labelledby={byId}
      className={`scroll-mt-28 border px-4 py-4 sm:px-5 ${
        p.status === "visible" ? "border-ink-900/12 bg-white/70" : "border-dashed border-ink-900/30 bg-paper-100/60"
      }`}
    >
      {p.status === "held" && (
        <div className="mb-3 border-l-4 border-ember-500 bg-paper-100 px-4 py-3" role="note">
          <p className="text-[15px] font-semibold text-ink-900">{t("awaitingReview")}</p>
          {p.mine && <p className="mt-1 text-[15px] text-ink-700">{t("awaitingReviewBody")}</p>}
          {p.held_reasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-ink-700">
              {p.held_reasons.map((r) => (
                <li key={r}>{tr(r)}</li>
              ))}
            </ul>
          )}
          {p.mine && p.held_reasons.some((r) => LOCATION_REASONS.includes(r)) && (
            <Link href="/report" className={`${link} mt-2 inline-flex min-h-11 items-center text-[15px]`}>
              {t("fileReport")}
            </Link>
          )}
        </div>
      )}
      {(p.status === "hidden" || p.status === "deleted") && (
        <div className="mb-3 border-l-4 border-ink-900/40 bg-paper-100 px-4 py-3" role="note">
          <p className="text-[15px] font-semibold text-ink-900">
            {p.status === "hidden" ? t("hiddenTitle") : t("deletedTitle")}
          </p>
          {p.moderator_note && (
            <p className="mt-1 text-[15px] text-ink-700">{t("moderatorNote", { reason: p.moderator_note })}</p>
          )}
        </div>
      )}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span id={byId}>
          <Nickname handle={p.author_handle} locale={locale} moderator={p.author_is_moderator} />
        </span>
        <time dateTime={p.created_at.toISOString()} className="text-[14px] text-ink-600">
          {when(p.created_at)}
        </time>
        {answering && <span className="text-[14px] text-ink-600">{answering}</span>}
      </header>
      <div className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-ink-950 [overflow-wrap:anywhere]">
        {p.body}
      </div>
      {p.edited_by_moderator && <p className="mt-2 text-[14px] italic text-ink-600">{t("editedByModerator")}</p>}
      <footer className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2">
        {p.status === "visible" && thread.status === "visible" && (
          <VoteControl
            postId={p.id}
            score={p.score}
            mine={votes.get(p.id) ?? 0}
            canVote={canVote}
            describedBy={p.is_opener ? "thread-title" : byId}
          />
        )}
        {replyable && mayReplyTo(p, ctx) && (
          <details className="open:basis-full">
            <summary className={`${btnQuiet} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
              {t("replyToThis")}
            </summary>
            <div className="mt-2 border border-ink-900/15 bg-white px-4 py-4">
              <ReplyComposer threadId={thread.id} parentId={p.id} />
            </div>
          </details>
        )}
        {p.mine && p.status !== "deleted" && <DeleteOwnForm postId={p.id} />}
        {!p.mine && viewer.member && !viewer.suspendedUntil && p.status === "visible" && <FlagForm postId={p.id} />}
      </footer>
      {viewer.canModerate && p.status !== "deleted" && (
        <div className="mt-4 border-t border-ink-900/10 pt-3">
          <ModeratePost
            postId={p.id}
            body={p.body}
            title={p.is_opener ? thread.title : undefined}
            status={p.status}
            authorHandle={p.author_handle}
            mine={p.mine}
          />
        </div>
      )}
    </article>
  );
}

/**
 * Replies, nested as lists inside lists, so a screen reader says how deep
 * each one is ("list, 3 items, level 2") and a reader can skip a whole
 * branch. Articles sit side by side, never inside each other: a reply is not
 * part of the post it answers.
 *
 * The indent is a rule down the left, as on Reddit, narrow enough that the
 * fourth level still has most of a 320px phone to itself.
 */
export async function ReplyTree({ nodes, ctx }: { nodes: ReplyNode<PostRow>[]; ctx: ThreadContext }) {
  const t = await getTranslations("forum");
  return (
    <ol className="space-y-3">
      {nodes.map((n) => (
        <li key={n.id}>
          {n.post ? (
            <PostCard post={n.post} ctx={ctx} />
          ) : (
            <p className="border border-dashed border-ink-900/25 bg-paper-100/60 px-4 py-3 text-[15px] italic text-ink-600">
              {t("removedPlace")}
            </p>
          )}
          {n.children.length > 0 && (
            <div className="mt-3 border-l-2 border-ink-900/15 pl-3 sm:pl-5">
              <ReplyTree nodes={n.children} ctx={ctx} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
