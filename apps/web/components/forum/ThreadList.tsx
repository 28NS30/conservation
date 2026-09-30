import { getFormatter, getNow, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ForumViewer } from "@/lib/forum/server";
import type { ThreadRow } from "@/lib/forum/queries";
import { voteRefusal } from "@/lib/forum/policy";
import { StartedBy } from "./Nickname";
import VoteControl from "./VoteControl";
import { badge } from "./styles";

/**
 * A feed: threads as Reddit lists them, the community (on the front page),
 * who started it and when, the title, and under it the score with its arrows
 * and the number of replies.
 *
 * Each title is a heading, so a screen reader can move from thread to thread
 * the way a sighted reader's eye does. The title and the author are separate
 * links, side by side: a link cannot hold a link.
 *
 * A thread the viewer started, one whose author has left, one that is locked,
 * and one still waiting for a moderator show their score without arrows; the
 * action refuses those votes anyway (policy.ts voteRefusal), this only avoids
 * offering them.
 */
export default async function ThreadList({
  threads,
  votes,
  viewer,
  locale,
  showCommunity = false,
}: {
  threads: ThreadRow[];
  /** The viewer's own votes, by opening post. */
  votes: Map<string, 1 | -1>;
  viewer: ForumViewer;
  locale: string;
  showCommunity?: boolean;
}) {
  const [t, format, now] = await Promise.all([getTranslations("forum"), getFormatter(), getNow()]);
  const zh = locale.startsWith("zh");

  return (
    <ul className="border-t border-ink-900/10">
      {threads.map((th) => {
        const titleId = `thread-${th.id}-title`;
        const own = Boolean(viewer.member && th.author_handle === viewer.member.handle);
        const canVote =
          viewer.canPost &&
          voteRefusal({
            own,
            authorLeft: th.author_handle === null,
            status: th.status,
            threadStatus: th.status,
            locked: th.locked,
            archived: false,
          }) === null;
        return (
          <li key={th.id} className="border-b border-ink-900/10 px-1 py-3">
            <article aria-labelledby={titleId}>
              <p className="flex flex-wrap items-center gap-x-2 text-[14px] text-ink-600">
                {showCommunity && (
                  <>
                    <Link
                      href={`/community/c/${th.category_slug}`}
                      className="inline-flex min-h-11 items-center font-semibold text-forest-900 underline-offset-2 hover:underline"
                    >
                      {zh ? th.category_name_zh : th.category_name_en}
                    </Link>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span>
                  <StartedBy handle={th.author_handle} locale={locale} />
                </span>
                <span aria-hidden>·</span>
                <time
                  dateTime={th.created_at.toISOString()}
                  title={format.dateTime(th.created_at, { dateStyle: "medium", timeStyle: "short" })}
                >
                  {format.relativeTime(th.created_at, now)}
                </time>
              </p>
              {/* A pin belongs to its community's feed, so the front page does not show one. */}
              {((th.pinned_at && !showCommunity) || th.locked || th.status !== "visible") && (
                <span className="mb-1 flex flex-wrap gap-2">
                  {th.status !== "visible" && (
                    <span className={`${badge} bg-ember-500 text-ink-950`}>
                      {th.status === "hidden" ? t("hiddenTitle") : t("awaitingReview")}
                    </span>
                  )}
                  {th.pinned_at && !showCommunity && (
                    <span className={`${badge} bg-forest-900 text-paper-50`}>{t("pinned")}</span>
                  )}
                  {th.locked && <span className={`${badge} border border-ink-900/25 text-ink-700`}>{t("locked")}</span>}
                </span>
              )}
              <h3 id={titleId} className="text-[18px] font-semibold leading-snug [overflow-wrap:anywhere]">
                <Link href={`/community/t/${th.id}`} className="block py-1.5 text-forest-900 hover:underline">
                  {th.title}
                </Link>
              </h3>
              {th.status === "visible" && th.opener_id && (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <VoteControl
                    postId={th.opener_id}
                    score={th.score}
                    mine={votes.get(th.opener_id) ?? 0}
                    canVote={canVote}
                    describedBy={titleId}
                  />
                  <Link
                    href={`/community/t/${th.id}#replies`}
                    className="inline-flex min-h-11 items-center px-1 text-[14px] text-ink-700 underline decoration-ink-900/30 underline-offset-4 hover:text-ink-900"
                  >
                    {t("replyCount", { count: th.reply_count })}
                  </Link>
                </div>
              )}
            </article>
          </li>
        );
      })}
    </ul>
  );
}
