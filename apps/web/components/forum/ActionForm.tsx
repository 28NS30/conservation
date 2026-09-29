"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/lib/forum/result";

/**
 * A form bound to one forum server action, with its answer shown under it.
 *
 * Every forum form is this. The action answers with a message KEY (see
 * lib/forum/result.ts) and this translates it, so a refusal — "too fast",
 * "choose a reason" — arrives in the reader's language, next to the button
 * that caused it, and is announced: role="alert" for a refusal, "status" for
 * the expected outcome.
 *
 * The fields are inside a <fieldset> that is disabled while the action runs,
 * so a double tap on a slow phone connection does not post twice.
 */
export default function ActionForm({
  action,
  children,
  className,
  successClassName,
}: {
  action: (prev: ActionResult, form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  /** Hide the fields once it worked, e.g. a flag form that has done its job. */
  successClassName?: string;
}) {
  const t = useTranslations("forum.msg");
  const tr = useTranslations("forum.reason");
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className} aria-busy={pending || undefined}>
      <fieldset disabled={pending} className={`min-w-0 ${state?.ok && successClassName ? successClassName : ""}`}>
        {children}
      </fieldset>
      {state?.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mt-2 text-[14px] leading-relaxed ${state.ok ? "text-leaf-700" : "text-ember-700"}`}
        >
          {t(state.message)}
        </p>
      )}
      {/* Why a post is waiting, in the poster's own words rather than a code. */}
      {state?.reasons && state.reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-ink-700">
          {state.reasons.map((r) => (
            <li key={r}>{tr(r)}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
