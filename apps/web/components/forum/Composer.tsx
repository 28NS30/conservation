import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createThread, replyToThread } from "@/app/[locale]/(site)/community/actions";
import { BODY_MAX, TITLE_MAX } from "@/lib/forum/policy";
import ActionForm from "./ActionForm";
import { btnPrimary, hint, label, link, textarea, input } from "./styles";

/**
 * The reminder that sits above every place to write.
 *
 * One sentence, every time, rather than a checkbox at sign-up and nothing
 * after: the moment the rule matters is the moment someone is about to type
 * where they saw the pangolin.
 */
async function Reminder() {
  const t = await getTranslations("forum");
  return (
    <p className="mb-4 border-l-4 border-ember-500 bg-paper-100 px-4 py-3 text-[15px] leading-relaxed text-ink-800">
      {t("reminder")}{" "}
      <Link href="/community/guidelines" className={`${link} inline-flex min-h-11 items-center`}>
        {t("reminderLink")}
      </Link>
      {" · "}
      <Link href="/report" className={`${link} inline-flex min-h-11 items-center`}>
        {t("fileReport")}
      </Link>
    </p>
  );
}

/** Start a thread in a topic. Plain text only: what is typed is what is shown. */
export async function ThreadComposer({ categorySlug, categoryName }: { categorySlug: string; categoryName: string }) {
  const t = await getTranslations("forum");
  return (
    <section id="new-thread" aria-labelledby="new-thread-title" className="mt-12 scroll-mt-28">
      <h2
        id="new-thread-title"
        className="font-display text-[28px] font-bold leading-tight text-forest-900 [overflow-wrap:anywhere]"
      >
        {t("newThreadIn", { category: categoryName })}
      </h2>
      <div className="mt-4">
        <Reminder />
        <ActionForm action={createThread} className="space-y-4">
          <input type="hidden" name="category" value={categorySlug} />
          <div>
            <label htmlFor="thread-title" className={label}>
              {t("titleLabel")}
            </label>
            <input
              id="thread-title"
              name="title"
              required
              minLength={3}
              maxLength={TITLE_MAX}
              aria-describedby="thread-title-hint"
              className={`${input} mt-2`}
            />
            <p id="thread-title-hint" className={hint}>
              {t("titleHint")}
            </p>
          </div>
          <div className="mt-4">
            <label htmlFor="thread-body" className={label}>
              {t("bodyLabel")}
            </label>
            <textarea
              id="thread-body"
              name="body"
              required
              minLength={2}
              maxLength={BODY_MAX}
              rows={8}
              aria-describedby="thread-body-hint"
              className={`${textarea} mt-2`}
            />
            <p id="thread-body-hint" className={hint}>
              {t("bodyHint")}
            </p>
          </div>
          <button type="submit" className={`${btnPrimary} mt-4`}>
            {t("post")}
          </button>
        </ActionForm>
      </div>
    </section>
  );
}

/** Reply at the foot of a thread. */
export async function ReplyComposer({ threadId }: { threadId: string }) {
  const t = await getTranslations("forum");
  return (
    <div>
      <Reminder />
      <ActionForm action={replyToThread} className="space-y-4">
        <input type="hidden" name="thread" value={threadId} />
        <label htmlFor="reply-body" className={label}>
          {t("replyLabel")}
        </label>
        <textarea
          id="reply-body"
          name="body"
          required
          minLength={2}
          maxLength={BODY_MAX}
          rows={6}
          aria-describedby="reply-body-hint"
          className={`${textarea} mt-2`}
        />
        <p id="reply-body-hint" className={hint}>
          {t("bodyHint")}
        </p>
        <button type="submit" className={`${btnPrimary} mt-4`}>
          {t("postReply")}
        </button>
      </ActionForm>
    </div>
  );
}
