import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { forumViewer, requireForum } from "@/lib/forum/server";
import { categoryBySlug, listCategories, listThreads, myVotes, ownUnpublishedThreads } from "@/lib/forum/queries";
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
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ page?: string; sort?: string; t?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  requireForum();
  const { locale, slug } = await params;
  const category = await categoryBySlug(slug);
  if (!category) return {};
  return { title: locale.startsWith("zh") ? category.name_zh : category.name_en };
}

/**
 * One community, like a subreddit: what it is for, a link to the rules, its
 * own feed (Hot, New or Top, twenty to a page, pinned threads first), and a
 * place to start a thread in it. The other communities are beside it.
 *
 * A member's own threads that are waiting for a moderator are listed above the
 * rest, marked, so a held first post does not look like one that vanished.
 * Announcements is read by everyone and started only by moderators.
 */
export default async function CategoryPage({ params, searchParams }: Props) {
  requireForum();
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const zh = locale.startsWith("zh");

  const category = await categoryBySlug(slug);
  if (!category) notFound();

  const { page, sort: rawSort, t: rawWindow } = await searchParams;
  const { sort, window } = parseFeedSort(rawSort, rawWindow);

  const [t, viewer, feed, categories] = await Promise.all([
    getTranslations("forum"),
    forumViewer(),
    listThreads({ categoryId: category.id, sort, window, page }),
    listCategories(),
  ]);
  const [mine, counts, votes] = await Promise.all([
    viewer.userId && viewer.member ? ownUnpublishedThreads(category.id, viewer.userId) : Promise.resolve([]),
    viewer.canModerate ? queueCounts() : Promise.resolve(null),
    viewer.userId && viewer.member
      ? myVotes(viewer.userId, feed.rows.flatMap((th) => (th.opener_id ? [th.opener_id] : [])))
      : Promise.resolve(new Map<string, 1 | -1>()),
  ]);

  const name = zh ? category.name_zh : category.name_en;
  const mayStart = viewer.canPost && (!category.moderators_only_post || viewer.isModerator);
  const path = `/community/c/${slug}`;

  return (
    <main>
      <ForumHeading
        title={name}
        lede={zh ? category.description_zh : category.description_en}
        crumbs={[{ href: "/community", label: t("home") }]}
        crumbLabel={t("breadcrumb")}
        zh={zh}
      >
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[14px] text-ink-600">
          <span>
            {t("threadCount", { count: category.thread_count })} · {t("postCount", { count: category.post_count })}
          </span>
          <span aria-hidden>·</span>
          <Link href="/community/guidelines" className={`${link} inline-flex min-h-11 items-center`}>
            {t("guidelines")}
          </Link>
        </p>
      </ForumHeading>

      <MemberStatus
        viewer={viewer}
        locale={locale}
        path={path}
        waiting={counts ? counts.held + counts.flagged : undefined}
      />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10">
        <div className="min-w-0">
          <CommunityChips categories={categories} current={slug} zh={zh} />

          {mayStart && (
            <p className="mb-6">
              <a href="#new-thread" className={btnPrimary}>
                {t("newThread")}
              </a>
            </p>
          )}
          {category.moderators_only_post && !viewer.isModerator && (
            <p className="mb-6 text-[15px] text-ink-700">{t("moderatorsOnlyPost")}</p>
          )}

          {mine.length > 0 && (
            <section aria-labelledby="mine" className="mb-10">
              <h2 id="mine" className="text-[18px] font-semibold text-ink-900">
                {t("yourUnpublished")}
              </h2>
              <div className="mt-2">
                <ThreadList threads={mine} votes={votes} viewer={viewer} locale={locale} />
              </div>
            </section>
          )}

          <section aria-labelledby="feed-title">
            <h2 id="feed-title" className="sr-only">
              {t("threads")}
            </h2>
            <FeedSortNav path={path} sort={sort} window={window} />
            {feed.rows.length === 0 ? (
              <p className="border border-ink-900/10 bg-white/50 px-5 py-8 text-center text-[16px] text-ink-700">
                {sort === "top" && window !== "all" ? t("noThreadsInWindow") : t("noThreads")}
              </p>
            ) : (
              <ThreadList threads={feed.rows} votes={votes} viewer={viewer} locale={locale} />
            )}
            <ForumPager
              page={feed.paging.page}
              hasPrev={feed.paging.hasPrev}
              hasNext={feed.paging.hasNext}
              path={path}
              query={feedQuery(sort, window)}
            />
          </section>

          {mayStart && <ThreadComposer categorySlug={category.slug} categoryName={name} />}
        </div>

        <CommunitySidebar categories={categories} current={slug} zh={zh} />
      </div>
    </main>
  );
}
