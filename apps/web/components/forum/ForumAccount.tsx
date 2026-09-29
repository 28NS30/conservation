import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { forumViewer } from "@/lib/forum/server";
import { forumEnabled } from "@/lib/forum/gate";
import { displayNickname } from "@/lib/forum/nickname";
import { withBase } from "@/lib/basePath";
import { leaveForum } from "@/app/[locale]/(site)/community/actions";
import ActionForm from "./ActionForm";
import { btnDanger, btnPrimary, btnSecondary, link } from "./styles";

/**
 * The forum's part of /me: who you are there, a copy of everything you wrote,
 * and a way to leave.
 *
 * Self-service because 個人資料保護法 Art. 3 gives people the right to a copy
 * of their data and to have it deleted, and a right that can only be exercised
 * by emailing a student is a right on paper. The download is a plain link to
 * a route handler (app/api/forum/export) so the browser saves a file; leaving
 * is a server action behind an explicit tick.
 *
 * Renders nothing, and asks nothing of the database, while the forum is off.
 */
export default async function ForumAccount({ locale }: { locale: string }) {
  if (!forumEnabled()) return null;
  const viewer = await forumViewer();
  if (!viewer.userId) return null;
  const t = await getTranslations("forum.me");

  return (
    <section aria-labelledby="forum-account" className="mt-12 border-t border-ink-900/10 pt-8">
      <h2 id="forum-account" className="text-lg font-semibold text-ink-900">
        {t("title")}
      </h2>
      {!viewer.member ? (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <p className="text-[15px] text-ink-700">{t("notJoined")}</p>
          <Link href="/community/join" className={btnPrimary}>
            {t("join")}
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[15px] text-ink-700">
            {t("name", {
              name: displayNickname({ key: viewer.member.nicknameKey, no: viewer.member.nicknameNo }, locale),
            })}{" "}
            <Link href={`/community/u/${viewer.member.handle}`} className={`${link} inline-flex min-h-11 items-center`}>
              {t("profile")}
            </Link>
          </p>

          <div className="mt-6">
            <h3 className="text-[16px] font-semibold text-ink-900">{t("exportTitle")}</h3>
            <p className="mt-1 text-[15px] text-ink-700">{t("exportBody")}</p>
            {/* A plain <a>: the file is a download, not a page to route to. */}
            <a href={withBase("/api/forum/export")} download className={`${btnSecondary} mt-3`}>
              {t("exportButton")}
            </a>
          </div>

          <div className="mt-8">
            <h3 className="text-[16px] font-semibold text-ink-900">{t("leaveTitle")}</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-700">{t("leaveBody")}</p>
            <ActionForm action={leaveForum} className="mt-3">
              <label className="flex min-h-11 items-center gap-3 text-[15px] text-ink-800">
                <input type="checkbox" name="confirm" required className="size-5 accent-leaf-600" />
                {t("leaveConfirm")}
              </label>
              <button type="submit" className={`${btnDanger} mt-2`}>
                {t("leaveButton")}
              </button>
            </ActionForm>
          </div>
        </>
      )}
    </section>
  );
}
