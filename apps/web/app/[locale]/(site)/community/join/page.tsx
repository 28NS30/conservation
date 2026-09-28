import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { sql } from "@/lib/db";
import { forumViewer, requireForum } from "@/lib/forum/server";
import { generateNickname, type Nickname } from "@/lib/forum/nickname";
import { forumSignInHref } from "@/lib/forum/signIn";
import ForumHeading from "@/components/forum/ForumHeading";
import JoinForm from "@/components/forum/JoinForm";
import { btnPrimary } from "@/components/forum/styles";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  requireForum();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "forum.join" });
  return { title: t("title") };
}

/**
 * A name nobody has, to offer first. Ten tries at 48 animals × 9,000 numbers
 * is not going to run out; if it somehow did, the join action's unique
 * constraint still refuses a duplicate and says so.
 */
async function freshNickname(): Promise<Nickname> {
  let candidate = generateNickname();
  for (let i = 0; i < 10; i++) {
    const [taken] = await sql`
      select 1 from forum_profiles
       where nickname_key = ${candidate.key} and nickname_no = ${candidate.no}`;
    if (!taken) break;
    candidate = generateNickname();
  }
  return candidate;
}

/**
 * Joining the forum, for someone who is signed in to the site.
 *
 * The forum uses the site's accounts: the same sign-in as "my reports", the
 * same `profiles` row, the same moderator roles. What joining adds is what a
 * forum needs and a report does not — a public name, an age group, and a
 * promise to follow the guidelines.
 */
export default async function JoinPage({ params }: { params: Promise<{ locale: string }> }) {
  requireForum();
  const { locale } = await params;
  setRequestLocale(locale);
  const zh = locale.startsWith("zh");
  const [t, tf, viewer] = await Promise.all([
    getTranslations("forum.join"),
    getTranslations("forum"),
    forumViewer(),
  ]);

  const crumbs = [{ href: "/community", label: tf("home") }];

  if (!viewer.userId) {
    return (
      <main>
        <ForumHeading title={t("title")} crumbs={crumbs} crumbLabel={tf("breadcrumb")} zh={zh} />
        <p className="text-[16px] text-ink-800">{tf("signInToJoin")}</p>
        <Link href={forumSignInHref(locale, "/community/join")} className={`${btnPrimary} mt-4`}>
          {tf("signIn")}
        </Link>
      </main>
    );
  }

  if (viewer.member) {
    return (
      <main>
        <ForumHeading title={t("title")} crumbs={crumbs} crumbLabel={tf("breadcrumb")} zh={zh} />
        <p className="text-[16px] text-ink-800">{t("already")}</p>
        <Link href="/community" className={`${btnPrimary} mt-4`}>
          {tf("home")}
        </Link>
      </main>
    );
  }

  const initial = await freshNickname();
  return (
    <main className="max-w-2xl">
      <ForumHeading title={t("title")} lede={t("lede")} crumbs={crumbs} crumbLabel={tf("breadcrumb")} zh={zh} />
      <JoinForm initial={initial} />
    </main>
  );
}
