"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  deleteMyAccount,
  type DeleteAccountState,
} from "@/app/[locale]/(site)/me/actions";

/**
 * The way to delete your own account, at the foot of /me.
 *
 * A form posting to a server action, so it works before the page's script has
 * loaded, with one box to tick: deleting cannot be undone, and a single button
 * on a page full of links is too easy to press by accident on a phone. The
 * paragraph says exactly what goes and what stays (see deleteMyAccount).
 */
export default function DeleteAccount() {
  const t = useTranslations("me.delete");
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(
    deleteMyAccount,
    null,
  );

  return (
    <section aria-labelledby="delete-account" className="mt-16 border-t border-ink-900/10 pt-8">
      <h2 id="delete-account" className="text-xl font-semibold text-forest-900">
        {t("title")}
      </h2>
      <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-800">{t("body")}</p>
      <form action={action} className="mt-4 space-y-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-ink-900">
          {/* Its own name: /me also holds the forum's leave form, whose box is
              "confirm", and two of those on one page is one too many for
              anything that looks a box up by name. */}
          <input type="checkbox" name="confirmDelete" className="size-5 accent-rose-800" />
          {t("confirm")}
        </label>
        {state?.error && (
          <p role="alert" className="text-sm text-rose-800">
            {t(`errors.${state.error}`)}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-lg border-2 border-rose-800 px-5 text-base font-semibold text-rose-800 hover:bg-rose-800/5 disabled:opacity-50"
        >
          {pending ? t("deleting") : t("button")}
        </button>
      </form>
    </section>
  );
}
