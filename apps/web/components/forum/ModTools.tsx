import { getTranslations } from "next-intl/server";
import {
  approvePost,
  deletePost,
  hidePost,
  moveThread,
  redactPost,
  setThreadLocked,
  setThreadPinned,
  suspendMember,
} from "@/app/[locale]/(site)/community/moderation/actions";
import { BODY_MAX, REASON_MAX, TITLE_MAX } from "@/lib/forum/policy";
import ActionForm from "./ActionForm";
import { btnDanger, btnPrimary, btnSecondary, hint, input, label, summaryButton, textarea } from "./styles";

/**
 * A moderator's controls for one post: approve, hide, delete, edit out a
 * location, suspend the author.
 *
 * Rendered only for moderators, on the thread page and in the console — and
 * that is presentation, not permission. Each form posts to an action that
 * checks the role again on the server (moderation/actions.ts).
 *
 * Hide, delete and suspend each ask for a reason the author will read. The
 * reason field is inside each form rather than shared, so a reason typed for a
 * hide can never be sent with a delete.
 */
export async function ModeratePost({
  postId,
  body,
  title,
  status,
  authorHandle,
  mine,
  showSuspend = true,
}: {
  postId: string;
  body: string;
  /** Set for an opening post, whose thread title can carry a location too. */
  title?: string;
  status: string;
  authorHandle: string | null;
  /** The moderator's own post: someone else decides on it. */
  mine: boolean;
  showSuspend?: boolean;
}) {
  const t = await getTranslations("forum.mod");
  if (mine) return <p className="text-[14px] text-ink-600">{t("ownPost")}</p>;

  const reasonField = (id: string) => (
    <div>
      <label htmlFor={id} className={label}>
        {t("reasonLabel")}
      </label>
      <input
        id={id}
        name="reason"
        required
        minLength={3}
        maxLength={REASON_MAX}
        aria-describedby={`${id}-hint`}
        className={`${input} mt-1`}
      />
      <p id={`${id}-hint`} className={hint}>
        {t("reasonHint")}
      </p>
    </div>
  );

  return (
    // One row of buttons; the one that is open takes the full width below
    // them, so a panel is never squeezed into the width of its button.
    <div className="flex flex-wrap items-start gap-2">
      {status !== "visible" && (
        <ActionForm action={approvePost}>
          <input type="hidden" name="post" value={postId} />
          <button type="submit" className={btnPrimary}>
            {t("approve")}
          </button>
        </ActionForm>
      )}

      <details className="open:basis-full">
        <summary className={summaryButton}>
          {t("redact")}
        </summary>
        <ActionForm action={redactPost} className="mt-2 border border-ink-900/15 bg-white px-4 py-4">
          <input type="hidden" name="post" value={postId} />
          <p className={hint}>{t("redactHelp")}</p>
          {title !== undefined && (
            <div className="mt-3">
              <label htmlFor={`redact-title-${postId}`} className={label}>
                {t("titleLabel")}
              </label>
              <input
                id={`redact-title-${postId}`}
                name="title"
                defaultValue={title}
                required
                maxLength={TITLE_MAX}
                className={`${input} mt-1`}
              />
            </div>
          )}
          <div className="mt-3">
            <label htmlFor={`redact-body-${postId}`} className={label}>
              {t("bodyLabel")}
            </label>
            <textarea
              id={`redact-body-${postId}`}
              name="body"
              defaultValue={body}
              required
              maxLength={BODY_MAX}
              rows={6}
              className={`${textarea} mt-1`}
            />
          </div>
          <div className="mt-3">{reasonField(`redact-reason-${postId}`)}</div>
          <label className="mt-2 flex min-h-11 items-center gap-3 text-[15px] text-ink-800">
            <input type="checkbox" name="approve" defaultChecked={status !== "visible"} className="size-5 accent-leaf-600" />
            {t("approveAfter")}
          </label>
          <button type="submit" className={`${btnSecondary} mt-2`}>
            {t("save")}
          </button>
        </ActionForm>
      </details>

      {status !== "hidden" && (
        <details className="open:basis-full">
          <summary className={summaryButton}>
            {t("hide")}
          </summary>
          <ActionForm action={hidePost} className="mt-2 border border-ink-900/15 bg-white px-4 py-4">
            <input type="hidden" name="post" value={postId} />
            {reasonField(`hide-reason-${postId}`)}
            <button type="submit" className={`${btnSecondary} mt-3`}>
              {t("hide")}
            </button>
          </ActionForm>
        </details>
      )}

      <details className="open:basis-full">
        <summary className={summaryButton}>
          {t("delete")}
        </summary>
        <ActionForm action={deletePost} className="mt-2 border border-ink-900/15 bg-white px-4 py-4">
          <input type="hidden" name="post" value={postId} />
          {reasonField(`delete-reason-${postId}`)}
          <button type="submit" className={`${btnDanger} mt-3`}>
            {t("delete")}
          </button>
        </ActionForm>
      </details>

      {showSuspend && authorHandle && (
        <details className="open:basis-full">
          <summary className={summaryButton}>
            {t("suspendAuthor")}
          </summary>
          <SuspendForm handle={authorHandle} idSuffix={postId} />
        </details>
      )}
    </div>
  );
}

/** Suspend a member by handle. Prefilled from a post, or typed in the console. */
export async function SuspendForm({ handle, idSuffix }: { handle?: string; idSuffix: string }) {
  const t = await getTranslations("forum.mod");
  return (
    <ActionForm action={suspendMember} className="mt-2 border border-ink-900/15 bg-white px-4 py-4">
      <p className={hint}>{t("suspendHelp")}</p>
      {handle ? (
        <input type="hidden" name="handle" value={handle} />
      ) : (
        <div className="mt-3">
          <label htmlFor={`suspend-handle-${idSuffix}`} className={label}>
            {t("handleLabel")}
          </label>
          <input
            id={`suspend-handle-${idSuffix}`}
            name="handle"
            required
            pattern="[a-z]+(-[a-z]+)*-[0-9]{4}"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={`${input} mt-1`}
          />
        </div>
      )}
      <div className="mt-3">
        <label htmlFor={`suspend-days-${idSuffix}`} className={label}>
          {t("daysLabel")}
        </label>
        <input
          id={`suspend-days-${idSuffix}`}
          name="days"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          defaultValue={1}
          required
          aria-describedby={`suspend-days-hint-${idSuffix}`}
          className={`${input} mt-1 max-w-32`}
        />
        <p id={`suspend-days-hint-${idSuffix}`} className={hint}>
          {t("daysHint")}
        </p>
      </div>
      <div className="mt-3">
        <label htmlFor={`suspend-reason-${idSuffix}`} className={label}>
          {t("reasonLabel")}
        </label>
        <input
          id={`suspend-reason-${idSuffix}`}
          name="reason"
          required
          minLength={3}
          maxLength={REASON_MAX}
          className={`${input} mt-1`}
        />
      </div>
      <button type="submit" className={`${btnDanger} mt-3`}>
        {t("suspend")}
      </button>
    </ActionForm>
  );
}

/** Lock, pin and move: a thread's own controls, on the thread page. */
export async function ThreadTools({
  threadId,
  locked,
  pinned,
  categorySlug,
  categories,
}: {
  threadId: string;
  locked: boolean;
  pinned: boolean;
  categorySlug: string;
  categories: { slug: string; name: string }[];
}) {
  const t = await getTranslations("forum.mod");
  return (
    <section aria-labelledby="thread-tools" className="mb-8 border border-forest-900/25 bg-white/60 px-4 py-4">
      <h2 id="thread-tools" className="text-[15px] font-semibold text-forest-900">
        {t("threadTools")}
      </h2>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <ActionForm action={setThreadLocked}>
          <input type="hidden" name="thread" value={threadId} />
          <input type="hidden" name="locked" value={locked ? "0" : "1"} />
          <button type="submit" className={btnSecondary}>
            {locked ? t("unlock") : t("lock")}
          </button>
        </ActionForm>
        <ActionForm action={setThreadPinned}>
          <input type="hidden" name="thread" value={threadId} />
          <input type="hidden" name="pinned" value={pinned ? "0" : "1"} />
          <button type="submit" className={btnSecondary}>
            {pinned ? t("unpin") : t("pin")}
          </button>
        </ActionForm>
        <ActionForm action={moveThread} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="thread" value={threadId} />
          <div>
            <label htmlFor={`move-${threadId}`} className="block text-[14px] text-ink-700">
              {t("moveTo")}
            </label>
            <select
              id={`move-${threadId}`}
              name="category"
              defaultValue={categorySlug}
              className={`${input} mt-1 min-w-40`}
            >
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={`${btnSecondary} mt-2`}>
            {t("move")}
          </button>
        </ActionForm>
      </div>
    </section>
  );
}
