import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { forumViewer, requireForum } from "@/lib/forum/server";
import { GUIDELINES_VERSION } from "@/lib/forum/policy";
import ForumHeading from "@/components/forum/ForumHeading";
import MemberStatus from "@/components/forum/MemberStatus";
import { link } from "@/components/forum/styles";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  requireForum();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "forum.rules" });
  return { title: t("title") };
}

/** The sections, in order. Each is a title and a body in `forum.rules`. */
const SECTIONS = ["kind", "location", "privacy", "here", "animals", "topic", "ages", "help", "how", "appeal", "data"] as const;

/**
 * The community guidelines, in words a thirteen-year-old reads without a
 * dictionary.
 *
 * They do three jobs. They are the rules members agree to when they join
 * (stored with the version, GUIDELINES_VERSION, so a change asks everyone
 * again). They are the self-regulation rules 兒童及少年福利與權益保障法 Art. 46
 * expects a platform minors use to publish. And they explain what moderation
 * does and how to appeal it, because a rule nobody can see enforced reads as
 * arbitrary. Pending legal review, like the rest of the forum (plan section 6).
 *
 * The second rule is the one the site exists for: never publish where a
 * protected animal lives. It is also enforced mechanically — lib/forum/screen.ts
 * holds any post with coordinates or a map link — and this page says so, so
 * that a held post is not a surprise.
 */
export default async function GuidelinesPage({ params }: { params: Promise<{ locale: string }> }) {
  requireForum();
  const { locale } = await params;
  setRequestLocale(locale);
  const zh = locale.startsWith("zh");
  const [t, tf, viewer] = await Promise.all([
    getTranslations("forum.rules"),
    getTranslations("forum"),
    forumViewer(),
  ]);
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "neolava2@gmail.com";

  return (
    <main className="max-w-2xl">
      <ForumHeading
        title={t("title")}
        lede={t("lede")}
        crumbs={[{ href: "/community", label: tf("home") }]}
        crumbLabel={tf("breadcrumb")}
        zh={zh}
      >
        <p className="mt-3 text-[14px] text-ink-600">{t("version", { version: GUIDELINES_VERSION })}</p>
      </ForumHeading>

      {viewer.member && !viewer.canPost && !viewer.suspendedUntil && (
        <MemberStatus viewer={viewer} locale={locale} path="/community/guidelines" />
      )}

      <div className="space-y-8">
        {SECTIONS.map((s) => (
          <section key={s} aria-labelledby={`rule-${s}`}>
            <h2 id={`rule-${s}`} className="text-[20px] font-semibold leading-snug text-forest-900">
              {t(`${s}Title`)}
            </h2>
            <p className="mt-2 text-[16px] leading-relaxed text-ink-800">{t(`${s}Body`)}</p>
            {s === "location" && (
              <Link href="/report" className={`${link} mt-1 inline-flex min-h-11 items-center text-[16px]`}>
                {tf("fileReport")}
              </Link>
            )}
            {s === "appeal" && (
              <a href={`mailto:${contact}`} className={`${link} mt-1 inline-flex min-h-11 items-center text-[16px]`}>
                {contact}
              </a>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
