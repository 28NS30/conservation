import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { forumViewer, requireForum } from "@/lib/forum/server";
import { listCategories } from "@/lib/forum/queries";
import { queueCounts } from "@/lib/forum/moderation";
import ForumHeading from "@/components/forum/ForumHeading";
import MemberStatus from "@/components/forum/MemberStatus";
import { link } from "@/components/forum/styles";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  requireForum();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "forum" });
  return { title: t("title") };
}

/**
 * The forum's front page: its topics, with how busy each is.
 *
 * Counts come from the public view, so they count only what the public can
 * read: a topic full of held posts reads as quiet, which is what it is to
 * everyone but the moderators.
 */
export default async function CommunityPage({ params }: { params: Promise<{ locale: string }> }) {
  requireForum();
  const { locale } = await params;
  setRequestLocale(locale);
  const zh = locale.startsWith("zh");

  const [t, format, viewer, categories] = await Promise.all([
    getTranslations("forum"),
    getFormatter(),
    forumViewer(),
    listCategories(),
  ]);
  const counts = viewer.canModerate ? await queueCounts() : null;

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

      <section aria-labelledby="topics">
        <h2 id="topics" className="sr-only">
          {t("categories")}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {categories.map((c) => (
            <li key={c.id}>
              <Link
                href={`/community/c/${c.slug}`}
                className="group flex h-full flex-col border border-ink-900/12 bg-white/60 p-5 transition hover:border-forest-900/40 hover:bg-white"
              >
                <span
                  className={`font-display text-[26px] font-bold leading-tight text-forest-900 group-hover:underline ${
                    zh ? "tracking-[0.03em]" : "uppercase"
                  }`}
                >
                  {zh ? c.name_zh : c.name_en}
                </span>
                <span className="mt-2 text-[15px] leading-relaxed text-ink-700">
                  {zh ? c.description_zh : c.description_en}
                </span>
                <span className="mt-auto pt-4 text-[14px] text-ink-600">
                  {t("threadCount", { count: c.thread_count })} · {t("postCount", { count: c.post_count })}
                  {c.last_activity_at && (
                    <>
                      {" · "}
                      {t("lastActivity", { date: format.dateTime(c.last_activity_at, { dateStyle: "medium" }) })}
                    </>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 border-t border-ink-900/10 pt-6 text-[15px] text-ink-700">
        {t("reminder")}{" "}
        <Link href="/community/guidelines" className={`${link} inline-flex min-h-11 items-center`}>
          {t("guidelines")}
        </Link>
      </p>
    </main>
  );
}
