import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { forumViewer, requireForum } from "@/lib/forum/server";
import { listCategories, listThreads, myVotes, ownUnpublishedThreads } from "@/lib/forum/queries";
import { queueCounts } from "@/lib/forum/moderation";
import { feedQuery, parseFeedSort } from "@/lib/forum/rank";
import ForumHeading from "@/components/forum/ForumHeading";
import MemberStatus from "@/components/forum/MemberStatus";
import { ThreadComposer } from "@/components/forum/Composer";
import ForumPager from "@/components/forum/ForumPager";
import { FeedSortNav } from "@/components/forum/SortNav";
import ThreadList from "@/components/forum/ThreadList";
import { CommunityChips, CommunitySidebar } from "@/components/forum/CommunityNav";
import { btnPrimary, link } from "@/components/forum/styles";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; sort?: string; t?: string }>;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  requireForum();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "forum" });
  return { title: t("title") };
}

/**
 * The forum's front page, like Reddit's: one feed of threads from every
 * community, Hot by default, with the communities beside it (above it on a
 * phone), each leading to its own page and feed.
 *
 * Everything in the feed comes from the public views, so it counts and ranks
 * only what the public can read: a held thread is not in it for anyone but its
 * author, who sees their own waiting threads listed above it.
 */
export default async function CommunityPage({ params, searchParams }: Props) {
  requireForum();
  const { locale } = await params;
  setRequestLocale(locale);
  const zh = locale.startsWith("zh");

  const { page, sort: rawSort, t: rawWindow } = await searchParams;
  const { sort, window } = parseFeedSort(rawSort, rawWindow);

  const [t, viewer, feed, categories] = await Promise.all([
    getTranslations("forum"),
    forumViewer(),
    listThreads({ categoryId: null, sort, window, page }),
    listCategories(),
  ]);
  const [mine, counts, votes] = await Promise.all([
    viewer.userId && viewer.member ? ownUnpublishedThreads(null, viewer.userId) : Promise.resolve([]),
    viewer.canModerate ? queueCounts() : Promise.resolve(null),
    viewer.userId && viewer.member
      ? myVotes(viewer.userId, feed.rows.flatMap((th) => (th.opener_id ? [th.opener_id] : [])))
      : Promise.resolve(new Map<string, 1 | -1>()),
  ]);

  // Where this member may start a thread: announcements only for moderators.
  const startIn = viewer.canPost
    ? categories
        .filter((c) => !c.moderators_only_post || viewer.isModerator)
        .map((c) => ({ slug: c.slug, name: zh ? c.name_zh : c.name_en }))
    : [];

  return (
    <main>
      <ForumHeading title={t("title")} lede={t("lede")} crumbLabel={t("breadcrumb")} zh={zh}>
        <p className="mt-3 text-[14px] text-ink-600">{t("pilot")}</p>
      </ForumHeading>

      <MemberStatus
        viewer={viewer}
        locale={locale}
        path="/community"
        waiting={counts ? counts.held + counts.flagged : undefined}
      />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10">
        <div className="min-w-0">
          <CommunityChips categories={categories} zh={zh} />

          {startIn.length > 0 && (
            <p className="mb-6">
              <a href="#new-thread" className={btnPrimary}>
                {t("newThread")}
              </a>
            </p>
          )}

          {mine.length > 0 && (
            <section aria-labelledby="mine" className="mb-10">
              <h2 id="mine" className="text-[18px] font-semibold text-ink-900">
                {t("yourUnpublished")}
              </h2>
              <div className="mt-2">
                <ThreadList threads={mine} votes={votes} viewer={viewer} locale={locale} showCommunity />
              </div>
            </section>
          )}

          <section aria-labelledby="feed-title">
            <h2 id="feed-title" className="sr-only">
              {t("threads")}
            </h2>
            <FeedSortNav path="/community" sort={sort} window={window} />
            {feed.rows.length === 0 ? (
              <p className="border border-ink-900/10 bg-white/50 px-5 py-8 text-center text-[16px] text-ink-700">
                {sort === "top" && window !== "all" ? t("noThreadsInWindow") : t("noThreadsAnywhere")}
              </p>
            ) : (
              <ThreadList threads={feed.rows} votes={votes} viewer={viewer} locale={locale} showCommunity />
            )}
            <ForumPager
              page={feed.paging.page}
              hasPrev={feed.paging.hasPrev}
              hasNext={feed.paging.hasNext}
              path="/community"
              query={feedQuery(sort, window)}
            />
          </section>

          {startIn.length > 0 && <ThreadComposer communities={startIn} />}
        </div>

        <CommunitySidebar categories={categories} zh={zh} />
      </div>

      {/* On a phone the sidebar's reminder is not shown; the composer has its own. */}
      {startIn.length === 0 && (
        <p className="mt-10 border-t border-ink-900/10 pt-6 text-[15px] text-ink-700 lg:hidden">
          {t("reminder")}{" "}
          <Link href="/community/guidelines" className={`${link} inline-flex min-h-11 items-center`}>
            {t("guidelines")}
          </Link>
        </p>
      )}
    </main>
  );
}
