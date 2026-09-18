"use client";

import Field from "@/components/lab/ui/Field";
import PageTitle from "@/components/lab/ui/PageTitle";
import type { LabCopy } from "@/lib/lab/copy";
import RecordSummary from "./RecordSummary";
import type { ReportFlow } from "./useReportFlow";

/**
 * Check and send: the photo large, four rows, and everything optional folded
 * away.
 *
 * This is the only screen in the flow allowed to scroll, and the button stays
 * pinned while it does — so however long the record gets, the way out of the
 * form is always in the same place under the thumb.
 *
 * The note and the email are behind a closed disclosure because almost nobody
 * needs them and an open textarea reads as a question. Notably there is no
 * advice anywhere to write a species name in the note: `notes` is a public
 * column in `reports_public`, and inviting free text that is really an
 * identification puts unreviewed strings on a public map.
 */
export default function SendStep({
  copy,
  flow,
  titleId,
  heading = "h1",
}: {
  copy: LabCopy;
  flow: ReportFlow;
  titleId: string;
  heading?: "h1" | "h2";
}) {
  const photo = flow.state.photos[0];

  return (
    <div>
      {heading === "h1" ? (
        <PageTitle id={titleId} size="title">
          {copy.report.sendTitle}
        </PageTitle>
      ) : (
        <h2 id={titleId} className="t-head text-(--fg)">
          {copy.report.sendTitle}
        </h2>
      )}

      {photo ? (
        <div
          data-surface="plate"
          className="rounded-(--radius-sign) mt-8 aspect-4/3 w-full overflow-hidden bg-(--ground)"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt="" className="h-full w-full object-cover" />
        </div>
      ) : null}

      <RecordSummary copy={copy} state={flow.state} className="mt-8" />

      <details className="mt-8">
        <summary className="t-body flex min-h-11 items-center text-(--fg)">
          {copy.report.sendNote}
        </summary>
        <div className="mt-4">
          <Field
            as="textarea"
            id="lab-note"
            rows={3}
            label={copy.report.noteLabel}
            value={flow.state.note}
            onChange={(event) => flow.setNote(event.target.value)}
          />
          <Field
            className="mt-6"
            id="lab-email"
            type="email"
            autoComplete="email"
            label={copy.report.emailLabel}
            value={flow.state.email}
            onChange={(event) => flow.setEmail(event.target.value)}
          />
        </div>
      </details>

      <p className="t-note mt-8 text-(--fg-quiet)">{copy.report.privacy}</p>
    </div>
  );
}
