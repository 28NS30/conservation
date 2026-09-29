import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { forumViewer, requireForum } from "@/lib/forum/server";
import {
  activeSuspensions,
  auditLog,
  flaggedQueue,
  heldQueue,
  roleHolders,
  watchedWordList,
  type QueueItem,
} from "@/lib/forum/moderation";
import { displayHandle } from "@/lib/forum/nickname";
import { LOCATION_REASONS } from "@/lib/forum/screen";
import { REASON_MAX } from "@/lib/forum/policy";
import { forumSignInHref } from "@/lib/forum/signIn";
import ForumHeading from "@/components/forum/ForumHeading";
import ActionForm from "@/components/forum/ActionForm";
import { ModeratePost, SuspendForm } from "@/components/forum/ModTools";
import { addWatchedWord, liftSuspension, removeWatchedWord, setMemberRole } from "./actions";
import { btnPrimary, btnQuiet, btnSecondary, hint, input, label, link, summaryButton } from "@/components/forum/styles";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  requireForum();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "forum.mod" });
  return { title: t("title") };
}

/**
 * The moderation console: what is waiting, what is flagged, who is suspended,
 * the watched words, roles (admins), and the log of every action.
 *
 * The page checks the role to decide what to render; the actions check it
 * again to decide what to do (./actions.ts). Only the second is security.
 *
 * People appear as their community name, their account's age and their
 * suspension count — never an email or a real name. Moderators are students,
 * and a queue that showed who someone really is would make a decision about
 * a post into a decision about a classmate.
 *
 * Held posts are shown here in full, coordinates and all: a moderator has to
 * read what they are deciding on. That is why this page, like /admin, is kept
 * out of the screenshot gallery (e2e/routes.mjs).
 */
export default async function ModerationPage({ params }: { params: Promise<{ locale: string }> }) {
  requireForum();
  const { locale } = await params;
  setRequestLocale(locale);
  const zh = locale.startsWith("zh");
  const [t, tf, format, viewer] = await Promise.all([
    getTranslations("forum.mod"),
    getTranslations("forum"),
    getFormatter(),
    forumViewer(),
  ]);
  const crumbs = [{ href: "/community", label: tf("home") }];
  const shell = (body: React.ReactNode) => (
    <main>
      <ForumHeading title={t("title")} crumbs={crumbs} crumbLabel={tf("breadcrumb")} zh={zh} />
      {body}
    </main>
  );

  if (!viewer.userId)
    return shell(
      <Link href={forumSignInHref(locale, "/community/moderation")} className={btnPrimary}>
        {tf("signIn")}
      </Link>,
    );
  if (!viewer.isModerator) return shell(<p className="text-[16px] text-ink-800">{t("moderatorsOnly")}</p>);
  if (!viewer.member)
    return shell(
      <p className="flex flex-wrap items-center gap-4 text-[16px] text-ink-800">
        {t("joinFirst")}
        <Link href="/community/join" className={btnPrimary}>
          {tf("joinCta")}
        </Link>
      </p>,
    );

  if (viewer.suspendedUntil)
    return shell(
      <p className="text-[16px] text-ink-800">
        {tf("suspendedUntil", { date: format.dateTime(viewer.suspendedUntil, { dateStyle: "medium", timeStyle: "short" }) })}
      </p>,
    );

  const admin = viewer.role === "admin";
  const [held, flagged, suspensions, words, log, roles] = await Promise.all([
    heldQueue(),
    flaggedQueue(),
    activeSuspensions(),
    watchedWordList(),
    auditLog(),
    admin ? roleHolders() : Promise.resolve([]),
  ]);
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const name = (h: string | null) => displayHandle(h, locale) ?? tf("deletedMember");

  const sections = [
    ["held", `${t("heldTitle")} (${held.length})`],
    ["flagged", `${t("flaggedTitle")} (${flagged.length})`],
    ["suspensions", t("activeTitle")],
    ["words", t("wordsTitle")],
    ...(admin ? [["roles", t("rolesTitle")]] : []),
    ["log", t("logTitle")],
  ] as const;

  const card = (item: QueueItem) => (
    <li key={item.post_id} className="border border-ink-900/15 bg-white/70 px-4 py-4 sm:px-5">
      <p className="text-[14px] text-ink-600">
        <Link href={`/community/t/${item.thread_id}`} className={`${link} inline-flex min-h-11 items-center`}>
          {t("inThread", { title: item.thread_title })}
        </Link>
        {item.is_opener && <> · {t("opener")}</>}
      </p>
      <p className="text-[14px] text-ink-700">
        {t("author", { name: name(item.author_handle) })}
        {item.author_days !== null && <> · {t("accountAge", { days: item.author_days })}</>}
        {" · "}
        {t("sanctionCount", { count: item.author_sanctions })}
        {item.revisions > 0 && <> · {t("revisions", { count: item.revisions })}</>}
        {" · "}
        {when(item.created_at)}
      </p>
      {item.held_reasons.length > 0 && (
        <p className="mt-2 text-[14px] text-ink-800">
          <span className="font-semibold">{t("held")}:</span>{" "}
          {item.held_reasons.map((r) => t(`why.${r}`)).join(zh ? "、" : ", ")}
        </p>
      )}
      {item.flags.length > 0 && (
        <div className="mt-2">
          <p className="text-[14px] font-semibold text-ink-800">{t("flags")}</p>
          <ul className="mt-1 space-y-1 text-[14px] text-ink-700">
            {item.flags.map((f) => (
              <li key={f.id}>
                {t("flaggedBy", { reason: tf(`flag.${f.reason}`), name: name(f.reporter_handle) })}
                {f.note && <span className="block pl-3 italic text-ink-600">“{f.note}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.held_reasons.some((r) => LOCATION_REASONS.includes(r)) && (
        <p className="mt-3 border-l-4 border-ember-500 bg-paper-100 px-3 py-2 text-[14px] leading-relaxed text-ink-800">
          {t("locationWarning")}
        </p>
      )}
      <div className="mt-3 whitespace-pre-wrap border-l-2 border-ink-900/15 pl-3 text-[16px] leading-relaxed text-ink-950 [overflow-wrap:anywhere]">
        {item.is_opener && <p className="mb-1 font-semibold">{item.thread_title}</p>}
        {item.body}
      </div>
      <div className="mt-4 border-t border-ink-900/10 pt-3">
        <ModeratePost
          postId={item.post_id}
          body={item.body}
          title={item.is_opener ? item.thread_title : undefined}
          status={item.status}
          authorHandle={item.author_handle}
          mine={item.author_id === viewer.userId}
        />
      </div>
    </li>
  );

  const h2 = "font-display text-[28px] font-bold leading-tight text-forest-900 scroll-mt-28";
  const empty = "mt-3 border border-ink-900/10 bg-white/50 px-4 py-6 text-center text-[16px] text-ink-700";

  return (
    <main>
      <ForumHeading title={t("title")} lede={t("lede")} crumbs={crumbs} crumbLabel={tf("breadcrumb")} zh={zh} />

      <nav aria-label={t("title")} className="mb-10 flex flex-wrap gap-2">
        {sections.map(([id, text]) => (
          <a key={id} href={`#${id}`} className={btnSecondary}>
            {text}
          </a>
        ))}
      </nav>

      <section aria-labelledby="held" className="mb-14">
        <h2 id="held" className={h2}>
          {t("heldTitle")}
        </h2>
        {held.length === 0 ? <p className={empty}>{t("heldEmpty")}</p> : <ul className="mt-4 space-y-4">{held.map(card)}</ul>}
      </section>

      <section aria-labelledby="flagged" className="mb-14">
        <h2 id="flagged" className={h2}>
          {t("flaggedTitle")}
        </h2>
        {flagged.length === 0 ? (
          <p className={empty}>{t("flaggedEmpty")}</p>
        ) : (
          <ul className="mt-4 space-y-4">{flagged.map(card)}</ul>
        )}
      </section>

      <section aria-labelledby="suspensions" className="mb-14">
        <h2 id="suspensions" className={h2}>
          {t("activeTitle")}
        </h2>
        {suspensions.length === 0 ? (
          <p className={empty}>{t("activeEmpty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-ink-900/10 border-y border-ink-900/10">
            {suspensions.map((s) => (
              <li key={s.id} className="py-3">
                <p className="text-[15px] text-ink-900">
                  <span className="font-semibold">{name(s.handle)}</span> · {t("until", { date: when(s.ends_at) })}
                </p>
                <p className="text-[14px] text-ink-700">
                  {s.reason} · {name(s.actor_handle)}
                </p>
                <details className="mt-1">
                  <summary className={summaryButton}>
                    {t("lift")}
                  </summary>
                  <ActionForm action={liftSuspension} className="mt-2 border border-ink-900/15 bg-white px-4 py-4">
                    <input type="hidden" name="sanction" value={s.id} />
                    <label htmlFor={`lift-${s.id}`} className={label}>
                      {t("reasonLabel")}
                    </label>
                    <input
                      id={`lift-${s.id}`}
                      name="reason"
                      required
                      minLength={3}
                      maxLength={REASON_MAX}
                      className={`${input} mt-1`}
                    />
                    <button type="submit" className={`${btnSecondary} mt-3`}>
                      {t("lift")}
                    </button>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-8 text-[18px] font-semibold text-ink-900">{t("suspendTitle")}</h3>
        <SuspendForm idSuffix="console" />
      </section>

      <section aria-labelledby="words" className="mb-14">
        <h2 id="words" className={h2}>
          {t("wordsTitle")}
        </h2>
        <p className={hint}>{t("wordsHelp")}</p>
        <ActionForm action={addWatchedWord} className="mt-4 border border-ink-900/15 bg-white px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="word" className={label}>
                {t("wordLabel")}
              </label>
              <input id="word" name="word" required maxLength={60} className={`${input} mt-1`} />
            </div>
            <div>
              <label htmlFor="word-note" className={label}>
                {t("noteLabel")}
              </label>
              <input id="word-note" name="note" maxLength={200} className={`${input} mt-1`} />
            </div>
          </div>
          <button type="submit" className={`${btnSecondary} mt-3`}>
            {t("addWord")}
          </button>
        </ActionForm>
        <ul className="mt-4 flex flex-wrap gap-2">
          {words.map((w) => (
            <li key={w.id} className="flex items-center gap-1 border border-ink-900/15 bg-white/70 pl-3">
              <span className="text-[15px] text-ink-900" title={w.note ?? undefined}>
                {w.word}
              </span>
              <ActionForm action={removeWatchedWord}>
                <input type="hidden" name="id" value={w.id} />
                <button type="submit" className={btnQuiet} aria-label={`${t("removeWord")}: ${w.word}`}>
                  ×
                </button>
              </ActionForm>
            </li>
          ))}
        </ul>
      </section>

      {admin && (
        <section aria-labelledby="roles" className="mb-14">
          <h2 id="roles" className={h2}>
            {t("rolesTitle")}
          </h2>
          <p className={hint}>{t("rolesHelp")}</p>
          <ul className="mt-3 space-y-1 text-[15px] text-ink-800">
            {roles.map((r, i) => (
              <li key={`${r.handle}-${i}`}>
                {r.handle ? name(r.handle) : t("someone")} ·{" "}
                {r.role === "admin" ? t("roleAdmin") : t("roleModerator")}
              </li>
            ))}
          </ul>
          <ActionForm action={setMemberRole} className="mt-4 border border-ink-900/15 bg-white px-4 py-4">
            <label htmlFor="role-handle" className={label}>
              {t("handleLabel")}
            </label>
            <input
              id="role-handle"
              name="handle"
              required
              pattern="[a-z]+(-[a-z]+)*-[0-9]{4}"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={`${input} mt-1`}
            />
            <label htmlFor="role-next" className={`${label} mt-3`}>
              {t("roleLabel")}
            </label>
            <select id="role-next" name="role" className={`${input} mt-1 max-w-60`} defaultValue="moderator">
              <option value="moderator">{t("roleModerator")}</option>
              <option value="user">{t("roleUser")}</option>
            </select>
            <label htmlFor="role-reason" className={`${label} mt-3`}>
              {t("reasonLabel")}
            </label>
            <input
              id="role-reason"
              name="reason"
              required
              minLength={3}
              maxLength={REASON_MAX}
              className={`${input} mt-1`}
            />
            <button type="submit" className={`${btnSecondary} mt-3`}>
              {t("setRole")}
            </button>
          </ActionForm>
        </section>
      )}

      <section aria-labelledby="log">
        <h2 id="log" className={h2}>
          {t("logTitle")}
        </h2>
        {log.length === 0 ? (
          <p className={empty}>{t("logEmpty")}</p>
        ) : (
          <ol className="mt-4 divide-y divide-ink-900/10 border-y border-ink-900/10">
            {log.map((a) => (
              <li key={a.id} className="py-3 text-[15px] text-ink-800">
                <p>
                  {t("logLine", {
                    actor: a.actor_handle ? name(a.actor_handle) : t("formerModerator"),
                    action: t(`action.${a.action}`),
                  })}
                  {a.subject_handle && <> · {name(a.subject_handle)}</>}
                </p>
                <p className="text-[14px] text-ink-600">
                  {when(a.created_at)}
                  {a.reason && <> · {a.reason}</>}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
