"use client";

import { createContext, useActionState, useContext } from "react";
import { useTranslations } from "next-intl";
import type { ActionResult } from "@/lib/forum/result";
import { btnQuiet } from "./styles";

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
 *
 * With a `summary`, the form sits in a disclosure under a post ("Reply",
 * "Flag", "Delete"), and the disclosure is drawn open whenever the form has
 * an answer. Without JavaScript a post comes back as a new page, and a
 * <details> drawn closed shut the refusal away, with the reply that was
 * refused (review of the forum-reddit work, 30 September 2026).
 */
export default function ActionForm({
  action,
  children,
  className,
  successClassName,
  summary,
  intro,
}: {
  action: (prev: ActionResult, form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  /** Hide the fields once it worked, e.g. a flag form that has done its job. */
  successClassName?: string;
  /** Put the form behind a disclosure that this opens. */
  summary?: React.ReactNode;
  /** In a disclosure, what goes above the form, e.g. the reminder over a reply box. */
  intro?: React.ReactNode;
}) {
  const t = useTranslations("forum.msg");
  const tr = useTranslations("forum.reason");
  const [state, formAction, pending] = useActionState(action, null);
  const form = (
    <TypedBack value={state && !state.ok ? (state.typed ?? null) : null}>
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
    </TypedBack>
  );
  if (summary === undefined) return form;
  return (
    <details open={state ? true : undefined} className="open:basis-full">
      <summary className={`${btnQuiet} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{summary}</summary>
      <div className="mt-2 border border-ink-900/15 bg-white px-4 py-4">
        {intro}
        {form}
      </div>
    </details>
  );
}

/** What a refused submission typed, by field name: see ActionResult.typed. */
const TypedBack = createContext<Record<string, string> | null>(null);

/**
 * A text box that is given back what was typed in it when the action refused
 * it. React empties a form once its action has run, whatever the answer, and
 * without JavaScript the page comes back new; either way a post refused as
 * "too fast" would otherwise take the writer's words with it. After a post
 * that went through, the box is empty again.
 */
export function TypedTextarea(props: React.ComponentProps<"textarea"> & { name: string }) {
  const typed = useContext(TypedBack);
  return <textarea {...props} defaultValue={typed?.[props.name] ?? ""} />;
}

/** The one-line TypedTextarea, for a thread's title. */
export function TypedInput(props: React.ComponentProps<"input"> & { name: string }) {
  const typed = useContext(TypedBack);
  return <input {...props} defaultValue={typed?.[props.name] ?? ""} />;
}
