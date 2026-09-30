import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { forumViewer, requireForum } from "@/lib/forum/server";
import { listCategories, myVotes, postsForViewer, threadForViewer } from "@/lib/forum/queries";
import { REPLIES_PER_PAGE } from "@/lib/forum/policy";
import { parseReplySort } from "@/lib/forum/rank";
import { buildReplyTree } from "@/lib/forum/tree";
import { forumSignInHref } from "@/lib/forum/signIn";
import { pageWindow } from "@/lib/paging";
import ForumHeading from "@/components/forum/ForumHeading";
import { StartedBy } from "@/components/forum/Nickname";
import ForumPager from "@/components/forum/ForumPager";
import { ReplyComposer } from "@/components/forum/Composer";
import { PostCard, ReplyTree, type ThreadContext } from "@/components/forum/PostCard";
import { ReplySortNav } from "@/components/forum/SortNav";
import { ThreadTools } from "@/components/forum/ModTools";
import { badge, btnPrimary } from "@/components/forum/styles";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ page?: string; sort?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  requireForum();
  const { id } = await params;
  const viewer = await forumViewer();
  const thread = await threadForViewer(id, { userId: viewer.userId, isModerator: viewer.canModerate });
  return thread ? { title: thread.title } : {};
}

/**
 * One thread: its opening post with the score and arrows, a reply box, and
 * the replies as a tree, twenty top-level replies (with everything under
 * them) to a page, Best or New.
 *
 * WHO SEES WHAT. The public sees visible posts in a visible thread, read as
 * `web_anon` from the public views. A post's author also sees their own posts
 * that are waiting or were hidden, each marked with why. A moderator sees
 * everything, with the tools to act on it. A reply nobody here may read,
 * with replies under it, keeps its place as "[removed]", so the answers to
 * it still read as answers. A thread that is not public is a 404 to everyone
 * else: a held thread's title can carry the location as easily as its text.
 */
export default async function ThreadPage({ params, searchParams }: Props) {
  requireForum();
  const { locale, id } = await params;
  setRequestLocale(locale);
  const zh = locale.startsWith("zh");

  const viewer = await forumViewer();
  // Held and hidden posts are shown to someone who can act on them now, not
  // to a moderator who is suspended or has not joined.
  const reader = { userId: viewer.userId, isModerator: viewer.canModerate };
  const thread = await threadForViewer(id, reader);
  if (!thread) notFound();

  const { page: requested, sort: rawSort } = await searchParams;
  const sort = parseReplySort(rawSort);
  const rows = await postsForViewer(thread.id, reader);
  const opener = rows.find((p) => p.is_opener) ?? null;
  const replies = rows.filter((p) => !p.is_opener);
  const tree = buildReplyTree(replies, sort);
  const paging = pageWindow(requested, tree.length, REPLIES_PER_PAGE);
  const shown = tree.slice(paging.offset, paging.offset + REPLIES_PER_PAGE);

  const [t, format, categories, votes] = await Promise.all([
    getTranslations("forum"),
    getFormatter(),
    viewer.canModerate ? listCategories() : Promise.resolve([]),
    viewer.member && viewer.userId
      ? myVotes(
          viewer.userId,
          rows.filter((p) => p.status === "visible").map((p) => p.id),
        )
      : Promise.resolve(new Map<string, 1 | -1>()),
  ]);

  const categoryName = zh ? thread.category_name_zh : thread.category_name_en;
  const path = `/community/t/${thread.id}`;
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const ctx: ThreadContext = { thread, viewer, locale, votes, byId: new Map(rows.map((p) => [p.id, p])) };

  return (
    <main>
      <ForumHeading
        title={thread.title}
        titleId="thread-title"
        kind="content"
        crumbs={[
          { href: "/community", label: t("home") },
          { href: `/community/c/${thread.category_slug}`, label: categoryName },
        ]}
        crumbLabel={t("breadcrumb")}
        zh={zh}
      >
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-600">
          <span>
            <StartedBy handle={thread.author_handle} locale={locale} />
          </span>
          <span aria-hidden>·</span>
          <span>{when(thread.created_at)}</span>
          {thread.pinned_at && <span className={`${badge} bg-forest-900 text-paper-50`}>{t("pinned")}</span>}
          {thread.locked && <span className={`${badge} border border-ink-900/25 text-ink-700`}>{t("locked")}</span>}
        </p>
      </ForumHeading>

      {viewer.canModerate && (
        <ThreadTools
          threadId={thread.id}
          locked={thread.locked}
          pinned={Boolean(thread.pinned_at)}
          categorySlug={thread.category_slug}
          categories={categories.map((c) => ({ slug: c.slug, name: zh ? c.name_zh : c.name_en }))}
        />
      )}

      {opener && <PostCard post={opener} ctx={ctx} replyable={false} />}

      {thread.status === "visible" && (
        <section aria-labelledby="reply-title" className="mt-10">
          <h2 id="reply-title" className="font-display text-[28px] font-bold leading-tight text-forest-900">
            {t("reply")}
          </h2>
          <div className="mt-4">
            {thread.locked && !viewer.isModerator ? (
              <p className="text-[16px] text-ink-700">{t("lockedNotice")}</p>
            ) : !viewer.userId ? (
              <p className="flex flex-wrap items-center gap-4 text-[16px] text-ink-700">
                {t("signInToReply")}
                <Link href={forumSignInHref(locale, path)} className={btnPrimary}>
                  {t("signIn")}
                </Link>
              </p>
            ) : !viewer.member ? (
              <p className="flex flex-wrap items-center gap-4 text-[16px] text-ink-700">
                {t("joinToReply")}
                <Link href="/community/join" className={btnPrimary}>
                  {t("joinCta")}
                </Link>
              </p>
            ) : !viewer.canPost ? (
              <p className="text-[16px] text-ink-700">
                {viewer.suspendedUntil
                  ? t("suspendedUntil", { date: when(viewer.suspendedUntil) })
                  : t("guidelinesChangedBody")}
              </p>
            ) : (
              <ReplyComposer threadId={thread.id} />
            )}
          </div>
        </section>
      )}

      <section id="replies" aria-labelledby="replies-title" className="mt-12 scroll-mt-28">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="replies-title" className="font-display text-[28px] font-bold leading-tight text-forest-900">
            {t("replyCount", { count: thread.reply_count })}
          </h2>
          {replies.length > 1 && <ReplySortNav path={path} sort={sort} />}
        </div>
        {shown.length > 0 && <ReplyTree nodes={shown} ctx={ctx} />}
        <ForumPager
          page={paging.page}
          hasPrev={paging.hasPrev}
          hasNext={paging.hasNext}
          path={path}
          query={sort === "best" ? {} : { sort }}
          hash="replies"
        />
      </section>
    </main>
  );
}
