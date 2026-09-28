import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { forumViewer, requireForum } from "@/lib/forum/server";
import { listCategories, postsForViewer, threadForViewer, type PostRow } from "@/lib/forum/queries";
import { POSTS_PER_PAGE } from "@/lib/forum/policy";
import { LOCATION_REASONS } from "@/lib/forum/screen";
import { displayHandle } from "@/lib/forum/nickname";
import { forumSignInHref } from "@/lib/forum/signIn";
import { pageWindow } from "@/lib/paging";
import ForumHeading from "@/components/forum/ForumHeading";
import Nickname from "@/components/forum/Nickname";
import ForumPager from "@/components/forum/ForumPager";
import { ReplyComposer } from "@/components/forum/Composer";
import { DeleteOwnForm, FlagForm } from "@/components/forum/PostActions";
import { ModeratePost, ThreadTools } from "@/components/forum/ModTools";
import { badge, btnPrimary, link } from "@/components/forum/styles";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  requireForum();
  const { id } = await params;
  const viewer = await forumViewer();
  const thread = await threadForViewer(id, { userId: viewer.userId, isModerator: viewer.canModerate });
  return thread ? { title: thread.title } : {};
}

/**
 * One thread: its posts, oldest first, thirty to a page, and a reply box.
 *
 * WHO SEES WHAT. The public sees visible posts in a visible thread, read as
 * `web_anon` from the public views. A post's author also sees their own posts
 * that are waiting or were hidden, each marked with why. A moderator sees
 * everything, with the tools to act on it. A thread that is not public is a
 * 404 to everyone else: a held thread's title can carry the location as
 * easily as its text.
 *
 * Post text is rendered as text. React escapes it, so `<script>` shows as the
 * word "<script>", and there is no markdown and no auto-linking: a pasted
 * image URL stays a line of text, never a picture.
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

  const { page: requested } = await searchParams;
  const first = await postsForViewer(thread.id, 0, reader);
  const paging = pageWindow(requested, first.total, POSTS_PER_PAGE);
  const posts = paging.offset === 0 ? first : await postsForViewer(thread.id, paging.offset, reader);

  const [t, tr, format, categories] = await Promise.all([
    getTranslations("forum"),
    getTranslations("forum.reason"),
    getFormatter(),
    viewer.canModerate ? listCategories() : Promise.resolve([]),
  ]);

  const categoryName = zh ? thread.category_name_zh : thread.category_name_en;
  const path = `/community/t/${thread.id}`;
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  const statusNote = (p: PostRow) => {
    if (p.status === "held")
      return (
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
      );
    if (p.status === "hidden" || p.status === "deleted")
      return (
        <div className="mb-3 border-l-4 border-ink-900/40 bg-paper-100 px-4 py-3" role="note">
          <p className="text-[15px] font-semibold text-ink-900">
            {p.status === "hidden" ? t("hiddenTitle") : t("deletedTitle")}
          </p>
          {p.moderator_note && (
            <p className="mt-1 text-[15px] text-ink-700">{t("moderatorNote", { reason: p.moderator_note })}</p>
          )}
        </div>
      );
    return null;
  };

  return (
    <main>
      <ForumHeading
        title={thread.title}
        kind="content"
        crumbs={[
          { href: "/community", label: t("home") },
          { href: `/community/c/${thread.category_slug}`, label: categoryName },
        ]}
        crumbLabel={t("breadcrumb")}
        zh={zh}
      >
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-600">
          <span>{t("startedBy", { name: displayHandle(thread.author_handle, locale) ?? t("deletedMember") })}</span>
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

      <h2 className="sr-only">{t("posts")}</h2>
      <ol className="space-y-5">
        {posts.rows.map((p) => (
          <li key={p.id}>
            <article
              aria-labelledby={`post-${p.id}-by`}
              className={`border px-4 py-4 sm:px-5 ${
                p.status === "visible" ? "border-ink-900/12 bg-white/70" : "border-dashed border-ink-900/30 bg-paper-100/60"
              }`}
            >
              {statusNote(p)}
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span id={`post-${p.id}-by`}>
                  <Nickname handle={p.author_handle} locale={locale} moderator={p.author_is_moderator} />
                </span>
                <time dateTime={p.created_at.toISOString()} className="text-[14px] text-ink-600">
                  {when(p.created_at)}
                </time>
              </header>
              <div className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-ink-950 [overflow-wrap:anywhere]">
                {p.body}
              </div>
              {p.edited_by_moderator && (
                <p className="mt-2 text-[14px] italic text-ink-600">{t("editedByModerator")}</p>
              )}
              <footer className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
                {p.mine && p.status !== "deleted" && <DeleteOwnForm postId={p.id} />}
                {!p.mine && viewer.member && !viewer.suspendedUntil && p.status === "visible" && (
                  <FlagForm postId={p.id} />
                )}
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
          </li>
        ))}
      </ol>

      <ForumPager page={paging.page} hasPrev={paging.hasPrev} hasNext={paging.hasNext} path={path} />

      {thread.status === "visible" && (
      <section aria-labelledby="reply-title" className="mt-12">
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
    </main>
  );
}
