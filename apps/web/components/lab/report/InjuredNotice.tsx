"use client";

import Notice from "@/components/lab/ui/Notice";
import PageTitle from "@/components/lab/ui/PageTitle";
import type { LabCopy } from "@/lib/lab/copy";

/**
 * What the site owes anyone who says the animal is alive and hurt: that nobody
 * is coming.
 *
 * This is `injured-guidance` in the review, and today it is not said at all —
 * a reporter files an injured animal, reads "received", and reasonably believes
 * somebody has been told. Saying it before the report is sent, rather than
 * after, is the whole point: it is the moment a person might still call
 * somebody who can actually help.
 *
 * THE WORDS ARE NOT HERE, AND MUST NOT BE INVENTED. Which agency, which number
 * and in what wording is the owner's decision and it blocks shipping. A
 * prototype that made one up would be tested, approved and shipped with a phone
 * number nobody at the other end has agreed to answer. So the notice shows its
 * own shape with 文字待提供 in it, and the seam beneath says out loud that this
 * is a gap rather than a draft.
 */
export default function InjuredNotice({
  copy,
  titleId,
  heading = "h1",
  action,
}: {
  copy: LabCopy;
  titleId: string;
  heading?: "h1" | "h2";
  /** The acknowledgement, when it is not the pinned button's job. */
  action?: React.ReactNode;
}) {
  return (
    <div>
      {heading === "h1" ? (
        <PageTitle id={titleId} size="title">
          {copy.report.injuredTitle}
        </PageTitle>
      ) : (
        <h2 id={titleId} className="t-head text-(--fg)">
          {copy.report.injuredTitle}
        </h2>
      )}
      <Notice className="mt-8">{copy.report.injuredBody}</Notice>
      <div className="lab-strip mt-6 px-4 py-3">
        <p className="t-note">{copy.seam.wordingPending}</p>
      </div>
      {action ? <div className="mt-8">{action}</div> : null}
    </div>
  );
}
