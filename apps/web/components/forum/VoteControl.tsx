"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { votePost } from "@/app/[locale]/(site)/community/actions";
import { nextVote, type VoteValue } from "@/lib/forum/policy";

/**
 * A post's score, with the up and down arrows for a member who may vote on it.
 *
 * Each arrow is a toggle button (aria-pressed) in a real form, so it works
 * before the page's JavaScript has loaded, and it sends the vote it will
 * LEAVE, not "toggle" (policy.ts nextVote): pressing ▲ again takes the vote
 * back. That also makes a double tap harmless, which is why the buttons are
 * not disabled while the vote is on its way, as ActionForm's fields are: a
 * disabled button drops the keyboard focus, and the next arrow is one Tab
 * away from it.
 *
 * `describedBy` names what is being voted on (a thread's title, a reply's
 * author), so "Vote up, toggle button, pressed" is not said about nothing on
 * a page with thirty of them.
 *
 * Everyone else sees the score as words. Nobody sees who voted: only totals.
 */
export default function VoteControl({
  postId,
  score,
  mine,
  canVote,
  describedBy,
}: {
  postId: string;
  score: number;
  /** The viewer's own vote on it, or 0. */
  mine: VoteValue;
  canVote: boolean;
  describedBy?: string;
}) {
  const t = useTranslations("forum.vote");
  const tm = useTranslations("forum.msg");
  const [state, formAction, pending] = useActionState(votePost, null);

  if (!canVote) {
    return <span className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink-700">{t("points", { count: score })}</span>;
  }

  const arrow =
    "inline-flex size-11 items-center justify-center rounded-full transition focus-visible:relative";
  const idle = "text-ink-700 hover:bg-paper-200 hover:text-ink-900";
  return (
    <form action={formAction} aria-busy={pending || undefined} className="flex flex-wrap items-center">
      <input type="hidden" name="post" value={postId} />
      <div
        role="group"
        aria-label={t("group")}
        className="inline-flex items-center rounded-full border border-ink-900/20 bg-paper-50"
      >
        <button
          type="submit"
          name="value"
          value={String(nextVote(mine, 1))}
          aria-pressed={mine === 1}
          aria-describedby={describedBy}
          className={`${arrow} ${mine === 1 ? "bg-leaf-600 text-white hover:bg-leaf-700" : idle}`}
        >
          <Arrow up />
          <span className="sr-only">{t("up")}</span>
        </button>
        <span
          className={`min-w-8 px-1 text-center text-[15px] font-semibold tabular-nums ${
            mine === 1 ? "text-leaf-700" : mine === -1 ? "text-ember-700" : "text-ink-900"
          }`}
        >
          <span aria-hidden>{score}</span>
          <span className="sr-only">{t("points", { count: score })}</span>
        </span>
        <button
          type="submit"
          name="value"
          value={String(nextVote(mine, -1))}
          aria-pressed={mine === -1}
          aria-describedby={describedBy}
          className={`${arrow} ${mine === -1 ? "bg-ember-500 text-ink-950 hover:bg-ember-500/85" : idle}`}
        >
          <Arrow />
          <span className="sr-only">{t("down")}</span>
        </button>
      </div>
      {state && !state.ok && (
        <p role="alert" className="basis-full pt-1 text-[14px] leading-relaxed text-ember-700">
          {tm(state.message)}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="sr-only">
          {tm(state.message)}
        </p>
      )}
    </form>
  );
}

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={`size-5 ${up ? "" : "rotate-180"}`} fill="currentColor">
      <path d="M10 3.5 17 11h-4.25v5.5h-5.5V11H3z" />
    </svg>
  );
}
