import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ForumViewer } from "@/lib/forum/server";
import { acceptGuidelines } from "@/app/[locale]/(site)/community/actions";
import { displayNickname } from "@/lib/forum/nickname";
import { forumSignInHref } from "@/lib/forum/signIn";
import ActionForm from "./ActionForm";
import { btnPrimary, btnSecondary, link } from "./styles";

/**
 * Where the reader stands with the forum, at the top of its pages: signed out,
 * signed in but not joined, joined, asked to re-accept changed guidelines, or
 * suspended. One line each, with the one thing to do next.
 *
 * `path` is the page this sits on, so signing in comes back to it.
 */
export default async function MemberStatus({
  viewer,
  locale,
  path,
  waiting,
}: {
  viewer: ForumViewer;
  locale: string;
  path: string;
  /** Held plus flagged, for a moderator; omitted for everyone else. */
  waiting?: number;
}) {
  const t = await getTranslations("forum");
  const format = await getFormatter();
  const box = "mb-8 flex flex-col gap-3 border-l-4 bg-paper-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between";

  let body: React.ReactNode;
  if (!viewer.userId) {
    body = (
      <div className={`${box} border-forest-900`}>
        <p className="text-[16px] text-ink-800">{t("signInToJoin")}</p>
        <Link href={forumSignInHref(locale, path)} className={btnPrimary}>
          {t("signIn")}
        </Link>
      </div>
    );
  } else if (!viewer.member) {
    body = (
      <div className={`${box} border-forest-900`}>
        <p className="text-[16px] text-ink-800">{t("joinPrompt")}</p>
        <Link href="/community/join" className={btnPrimary}>
          {t("joinCta")}
        </Link>
      </div>
    );
  } else if (viewer.suspendedUntil) {
    body = (
      <div className={`${box} border-ember-500`} role="status">
        <p className="text-[16px] text-ink-800">
          {t("suspendedUntil", {
            date: format.dateTime(viewer.suspendedUntil, { dateStyle: "medium", timeStyle: "short" }),
          })}
        </p>
      </div>
    );
  } else if (!viewer.canPost) {
    // Joined, not suspended, and still unable to post: the guidelines changed.
    body = (
      <div className={`${box} flex-col !items-start border-ember-500`}>
        <div>
          <p className="text-[16px] font-semibold text-ink-900">{t("guidelinesChangedTitle")}</p>
          <p className="mt-1 text-[15px] text-ink-700">
            {t("guidelinesChangedBody")}{" "}
            <Link href="/community/guidelines" className={link}>
              {t("guidelines")}
            </Link>
          </p>
        </div>
        <ActionForm action={acceptGuidelines}>
          <label className="flex min-h-11 items-center gap-3 text-[15px] text-ink-800">
            <input type="checkbox" name="guidelines" className="size-5 accent-leaf-600" required />
            {t("join.guidelinesLabel")}
          </label>
          <button type="submit" className={`${btnSecondary} mt-2`}>
            {t("join.submit")}
          </button>
        </ActionForm>
      </div>
    );
  } else {
    const name = displayNickname({ key: viewer.member.nicknameKey, no: viewer.member.nicknameNo }, locale);
    body = (
      <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-ink-700">
        <p>
          {t.rich("youAre", {
            name,
            link: (chunks) => (
              <Link href={`/community/u/${viewer.member!.handle}`} className={`${link} inline-flex min-h-11 items-center`}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    );
  }

  return (
    <>
      {body}
      {viewer.canModerate && (
        <p className="-mt-5 mb-8">
          <Link href="/community/moderation" className={`${link} inline-flex min-h-11 items-center text-[15px]`}>
            {t("moderationWaiting", { count: waiting ?? 0 })}
          </Link>
        </p>
      )}
    </>
  );
}
