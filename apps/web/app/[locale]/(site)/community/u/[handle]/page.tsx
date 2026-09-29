import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireForum } from "@/lib/forum/server";
import { profileByHandle, recentPostsByHandle } from "@/lib/forum/queries";
import { displayNickname } from "@/lib/forum/nickname";
import ForumHeading from "@/components/forum/ForumHeading";
import { badge } from "@/components/forum/styles";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; handle: string }> };

/** The URL form of a handle; anything else is not a member and is not looked up. */
const HANDLE = /^[a-z]+(?:-[a-z]+)*-\d{4}$/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  requireForum();
  const { locale, handle } = await params;
  if (!HANDLE.test(handle)) return {};
  const profile = await profileByHandle(handle);
  if (!profile) return {};
  return { title: displayNickname({ key: profile.nickname_key, no: profile.nickname_no }, locale) };
}

/**
 * A member's public page: their name, the month they joined, whether they
 * moderate, and their latest public posts. Nothing else.
 *
 * Deliberately not here: age, email, sanctions, flags, and anything they have
 * REPORTED. A per-person list of species and places is an index of where one
 * person goes, which is exactly what a stranger should not be able to build
 * about a teenager (see the note on app/[locale]/(site)/me/page.tsx). Read
 * only through forum_profiles_public and forum_posts_public, as `web_anon`,
 * and never indexed (the community layout sets noindex).
 */
export default async function ProfilePage({ params }: Props) {
  requireForum();
  const { locale, handle } = await params;
  setRequestLocale(locale);
  const zh = locale.startsWith("zh");
  if (!HANDLE.test(handle)) notFound();

  const profile = await profileByHandle(handle);
  if (!profile) notFound();

  const [t, format, posts] = await Promise.all([
    getTranslations("forum"),
    getFormatter(),
    recentPostsByHandle(handle),
  ]);
  const name = displayNickname({ key: profile.nickname_key, no: profile.nickname_no }, locale);

  return (
    <main>
      <ForumHeading
        title={name}
        kind="content"
        crumbs={[{ href: "/community", label: t("home") }]}
        crumbLabel={t("breadcrumb")}
        zh={zh}
      >
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-ink-700">
          <span>{t("profileJoined", { month: format.dateTime(profile.joined_month, { year: "numeric", month: "long" }) })}</span>
          <span aria-hidden>·</span>
          <span>{t("profilePosts", { count: profile.post_count })}</span>
          {profile.is_moderator && <span className={`${badge} bg-forest-900 text-paper-50`}>{t("moderatorBadge")}</span>}
        </p>
      </ForumHeading>

      <section aria-labelledby="recent">
        <h2 id="recent" className="font-display text-[26px] font-bold text-forest-900">
          {t("recentPosts")}
        </h2>
        {posts.length === 0 ? (
          <p className="mt-3 text-[16px] text-ink-700">{t("noPosts")}</p>
        ) : (
          <ul className="mt-3 border-t border-ink-900/10">
            {posts.map((p) => (
              <li key={p.id} className="border-b border-ink-900/10">
                <Link href={`/community/t/${p.thread_id}`} className="group block px-1 py-4 hover:bg-white/70">
                  <span className="block text-[14px] text-ink-600">
                    {t("inThread", { title: p.thread_title })} ·{" "}
                    {format.dateTime(p.created_at, { dateStyle: "medium" })}
                  </span>
                  <span className="mt-1 line-clamp-3 block whitespace-pre-wrap text-[16px] leading-relaxed text-ink-950 [overflow-wrap:anywhere] group-hover:underline">
                    {p.body}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-[14px] text-ink-600">{t("profilePrivacy")}</p>
    </main>
  );
}
