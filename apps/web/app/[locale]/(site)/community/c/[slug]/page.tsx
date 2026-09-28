import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { forumViewer, requireForum } from "@/lib/forum/server";
import { categoryBySlug, listThreads, ownUnpublishedThreads, type ThreadRow } from "@/lib/forum/queries";
import { queueCounts } from "@/lib/forum/moderation";
import { THREADS_PER_PAGE } from "@/lib/forum/policy";
import { displayHandle } from "@/lib/forum/nickname";
import { pageWindow } from "@/lib/paging";
import ForumHeading from "@/components/forum/ForumHeading";
import MemberStatus from "@/components/forum/MemberStatus";
import { ThreadComposer } from "@/components/forum/Composer";
import ForumPager from "@/components/forum/ForumPager";
import { badge, btnPrimary } from "@/components/forum/styles";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  requireForum();
  const { locale, slug } = await params;
  const category = await categoryBySlug(slug);
  if (!category) return {};
  return { title: locale.startsWith("zh") ? category.name_zh : category.name_en };
}

/**
 * One topic: its threads, pinned first and then by newest activity, twenty to
 * a page, and a place to start a new one.
 *
 * A member's own threads that are waiting for a moderator are listed above the
 * rest, marked, so a held first post does not look like one that vanished.
 */
export default async function CategoryPage({ params, searchParams }: Props) {
  requireForum();
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const zh = locale.startsWith("zh");

  const category = await categoryBySlug(slug);
  if (!category) notFound();

  const { page: requested } = await searchParams;
  const paging = pageWindow(requested, category.thread_count, THREADS_PER_PAGE);

  const [t, format, viewer, threads] = await Promise.all([
    getTranslations("forum"),
    getFormatter(),
    forumViewer(),
    listThreads(category.id, paging.offset),
  ]);
  const [mine, counts] = await Promise.all([
    viewer.userId && viewer.member ? ownUnpublishedThreads(category.id, viewer.userId) : Promise.resolve([]),
    viewer.canModerate ? queueCounts() : Promise.resolve(null),
  ]);

  const name = zh ? category.name_zh : category.name_en;
  const mayStart = viewer.canPost && (!category.moderators_only_post || viewer.isModerator);

  const row = (th: ThreadRow) => (
    <li key={th.id} className="border-b border-ink-900/10">
      <Link href={`/community/t/${th.id}`} className="group block px-1 py-4 transition hover:bg-white/70">
        {(th.pinned_at || th.locked || th.status !== "visible") && (
          <span className="mb-1.5 flex flex-wrap gap-2">
            {th.status !== "visible" && (
              <span className={`${badge} bg-ember-500 text-ink-950`}>
                {th.status === "hidden" ? t("hiddenTitle") : t("awaitingReview")}
              </span>
            )}
            {th.pinned_at && <span className={`${badge} bg-forest-900 text-paper-50`}>{t("pinned")}</span>}
            {th.locked && <span className={`${badge} border border-ink-900/25 text-ink-700`}>{t("locked")}</span>}
          </span>
        )}
        <span className="block text-[18px] font-semibold leading-snug text-forest-900 [overflow-wrap:anywhere] group-hover:underline">
          {th.title}
        </span>
        <span className="mt-1 block text-[14px] text-ink-600">
          {t("startedBy", { name: displayHandle(th.author_handle, locale) ?? t("deletedMember") })}
          {" · "}
          {t("replyCount", { count: th.reply_count })}
          {" · "}
          {t("lastActivity", { date: format.dateTime(th.last_activity_at, { dateStyle: "medium", timeStyle: "short" }) })}
        </span>
      </Link>
    </li>
  );

  return (
    <main>
      <ForumHeading
        title={name}
        lede={zh ? category.description_zh : category.description_en}
        crumbs={[{ href: "/community", label: t("home") }]}
        crumbLabel={t("breadcrumb")}
        zh={zh}
      >
        <p className="mt-3 text-[14px] text-ink-600">
          {t("threadCount", { count: category.thread_count })} · {t("postCount", { count: category.post_count })}
        </p>
      </ForumHeading>

      <MemberStatus
        viewer={viewer}
        locale={locale}
        path={`/community/c/${slug}`}
        waiting={counts ? counts.held + counts.flagged : undefined}
      />

      {mayStart && (
        <p className="mb-8">
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
          <ul className="mt-2 border-t border-ink-900/10">{mine.map(row)}</ul>
        </section>
      )}

      <section aria-label={t("categories")}>
        {threads.rows.length === 0 ? (
          <p className="border border-ink-900/10 bg-white/50 px-5 py-8 text-center text-[16px] text-ink-700">
            {t("noThreads")}
          </p>
        ) : (
          <ul className="border-t border-ink-900/10">{threads.rows.map(row)}</ul>
        )}
        <ForumPager
          page={paging.page}
          hasPrev={paging.hasPrev}
          hasNext={paging.hasNext}
          path={`/community/c/${slug}`}
        />
      </section>

      {mayStart && <ThreadComposer categorySlug={category.slug} categoryName={name} />}
    </main>
  );
}
