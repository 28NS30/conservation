import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createThread, replyToThread } from "@/app/[locale]/(site)/community/actions";
import { BODY_MAX, TITLE_MAX } from "@/lib/forum/policy";
import ActionForm, { TypedInput, TypedTextarea } from "./ActionForm";
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

/**
 * Start a thread. Plain text only: what is typed is what is shown.
 *
 * On a community's page it goes in that community. On the front page the
 * writer chooses one, from the communities they may start threads in, with
 * nothing chosen for them: a thread in the wrong place is a moderator's move
 * later.
 */
export async function ThreadComposer(
  props: { categorySlug: string; categoryName: string } | { communities: { slug: string; name: string }[] },
) {
  const t = await getTranslations("forum");
  const chooser = "communities" in props ? props.communities : null;
  return (
    <section id="new-thread" aria-labelledby="new-thread-title" className="mt-12 scroll-mt-28">
      <h2
        id="new-thread-title"
        className="font-display text-[28px] font-bold leading-tight text-forest-900 [overflow-wrap:anywhere]"
      >
        {"categoryName" in props ? t("newThreadIn", { category: props.categoryName }) : t("newThread")}
      </h2>
      <div className="mt-4">
        <Reminder />
        <ActionForm action={createThread} className="space-y-4">
          {chooser ? (
            <div className="mb-4">
              <label htmlFor="thread-category" className={label}>
                {t("communityLabel")}
              </label>
              <select id="thread-category" name="category" required defaultValue="" className={`${input} mt-2`}>
                <option value="" disabled>
                  {t("chooseCommunity")}
                </option>
                {chooser.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <input type="hidden" name="category" value={"categorySlug" in props ? props.categorySlug : ""} />
          )}
          <div>
            <label htmlFor="thread-title" className={label}>
              {t("titleLabel")}
            </label>
            <TypedInput
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
            <TypedTextarea
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

/**
 * Reply to the thread, or, given `parentId`, to one reply in it: then behind
 * the "Reply" under that reply, which opens by itself when the form has an
 * answer to show (ActionForm). Each has its own ids, so a page with a dozen
 * of them still ties every label to its own box.
 */
export async function ReplyComposer({ threadId, parentId }: { threadId: string; parentId?: string }) {
  const t = await getTranslations("forum");
  const id = parentId ? `reply-body-${parentId}` : "reply-body";
  const fields = (
    <>
      <input type="hidden" name="thread" value={threadId} />
      {parentId && <input type="hidden" name="parent" value={parentId} />}
      <label htmlFor={id} className={label}>
        {t("replyLabel")}
      </label>
      <TypedTextarea
        id={id}
        name="body"
        required
        minLength={2}
        maxLength={BODY_MAX}
        rows={parentId ? 4 : 6}
        aria-describedby={`${id}-hint`}
        className={`${textarea} mt-2`}
      />
      <p id={`${id}-hint`} className={hint}>
        {t("bodyHint")}
      </p>
      <button type="submit" className={`${btnPrimary} mt-4`}>
        {t("postReply")}
      </button>
    </>
  );
  if (parentId)
    return (
      <ActionForm
        action={replyToThread}
        className="space-y-4"
        successClassName="hidden"
        summary={t("replyToThis")}
        intro={<Reminder />}
      >
        {fields}
      </ActionForm>
    );
  return (
    <div>
      <Reminder />
      <ActionForm action={replyToThread} className="space-y-4">
        {fields}
      </ActionForm>
    </div>
  );
}
