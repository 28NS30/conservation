import { getTranslations } from "next-intl/server";
import { deleteOwnPost, flagPost } from "@/app/[locale]/(site)/community/actions";
import { FLAG_REASONS, NOTE_MAX } from "@/lib/forum/policy";
import ActionForm from "./ActionForm";
import { btnDanger, btnQuiet, btnSecondary, hint, textarea } from "./styles";

/**
 * "Flag" under a post: a disclosure, so the reasons take no room until they
 * are wanted, and a real form inside it, so it works before the page's
 * JavaScript has loaded. Every post has one; the guidelines promise it.
 */
export async function FlagForm({ postId }: { postId: string }) {
  const t = await getTranslations("forum.flag");
  return (
    <details className="open:basis-full">
      <summary className={`${btnQuiet} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        <span aria-hidden>⚑</span> {t("button")}
      </summary>
      <div className="mt-2 border border-ink-900/15 bg-white px-4 py-4">
        <ActionForm action={flagPost} successClassName="hidden">
          <input type="hidden" name="post" value={postId} />
          <fieldset>
            <legend className="text-[15px] font-semibold text-ink-900">{t("legend")}</legend>
            <div className="mt-2 grid gap-1">
              {FLAG_REASONS.map((r) => (
                <label key={r} className="flex min-h-11 items-center gap-3 text-[15px] text-ink-800">
                  <input type="radio" name="reason" value={r} required className="size-5 accent-leaf-600" />
                  {t(r)}
                </label>
              ))}
            </div>
            <p className={hint}>{t("help")}</p>
          </fieldset>
          <label htmlFor={`flag-note-${postId}`} className="mt-3 block text-[15px] text-ink-800">
            {t("note")}
          </label>
          <textarea
            id={`flag-note-${postId}`}
            name="note"
            rows={2}
            maxLength={NOTE_MAX}
            className={`${textarea} mt-1`}
          />
          <button type="submit" className={`${btnSecondary} mt-3`}>
            {t("submit")}
          </button>
        </ActionForm>
      </div>
    </details>
  );
}

/** "Delete" under your own post, behind a second, explicit confirmation. */
export async function DeleteOwnForm({ postId }: { postId: string }) {
  const t = await getTranslations("forum");
  return (
    <details className="open:basis-full">
      <summary className={`${btnQuiet} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{t("deleteMine")}</summary>
      <div className="mt-2 border border-ink-900/15 bg-white px-4 py-4">
        <ActionForm action={deleteOwnPost} successClassName="hidden">
          <input type="hidden" name="post" value={postId} />
          <p className="text-[15px] text-ink-800">{t("deleteConfirm")}</p>
          <button type="submit" className={`${btnDanger} mt-3`}>
            {t("deleteYes")}
          </button>
        </ActionForm>
      </div>
    </details>
  );
}
