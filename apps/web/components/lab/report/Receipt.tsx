"use client";

import { useTranslations } from "next-intl";
import Button from "@/components/lab/ui/Button";
import Emblem from "@/components/lab/ui/Emblem";
import Notice from "@/components/lab/ui/Notice";
import PageTitle from "@/components/lab/ui/PageTitle";
import type { LabCopy } from "@/lib/lab/copy";
import { labPath, type LabDirection } from "@/lib/lab/directions";
import type { FlowState, Outcome } from "@/lib/lab/reportFlow";

/**
 * What the reporter is told, and the part of today's form that is not merely
 * ugly but wrong.
 *
 * Today a report with no photo is answered with "published" and a link to the
 * record, and the record is not published and the link 404s. The heading here
 * is the status — 已經在地圖上了 or 收到了，還沒公開 — and the link to the record
 * exists only in the case where there is a record to look at. Nothing promises
 * a timetable, because nobody has one: the held sentence says a person does it
 * by hand and does not guess at how long that takes.
 *
 * The injured referral is repeated here. Somebody who tapped through the notice
 * three screens ago while looking at a hurt animal has not read it, and this is
 * the last screen they will see.
 *
 * 同地點再一筆 is not a nicety. The reason a person files twice in a row is
 * almost always that there is more than one casualty on the same stretch of
 * road, and making them set the place again is the difference between a second
 * record and no second record.
 */
export default function Receipt({
  copy,
  direction,
  outcome,
  state,
  onAgain,
  onAgainSamePlace,
}: {
  copy: LabCopy;
  direction: LabDirection;
  outcome: Outcome;
  state: FlowState;
  onAgain: () => void;
  onAgainSamePlace: () => void;
}) {
  const offline = useTranslations("offline");

  const heading =
    outcome.kind === "published"
      ? copy.receipt.published
      : outcome.kind === "queued"
        ? copy.receipt.queued
        : copy.receipt.held;

  const body =
    outcome.kind === "queued"
      ? offline("explain")
      : outcome.reason === "no-species"
        ? copy.receipt.heldNoSpecies
        : outcome.reason === "no-photo"
          ? copy.receipt.heldNoPhoto
          : outcome.reason === "review"
            ? copy.receipt.heldReview
            : null;

  return (
    <div
      data-surface="plate"
      className="flex min-h-[100dvh] flex-col bg-(--ground) text-(--fg)"
    >
      {/* A `<main>`, not a div. The receipt replaces the whole flow — the
          FlowShell and its own main are gone by the time this renders — so
          without it the one screen a reporter is left looking at has no main
          landmark and no content inside any landmark at all. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-(--gutter) py-16">
        <Emblem size={160} className="h-40 w-40" />
        <PageTitle size="title" className="mt-10">
          {heading}
        </PageTitle>
        {body ? (
          <p className="t-body mt-6 max-w-(--container-prose) text-(--fg-quiet)">
            {body}
          </p>
        ) : null}

        {state.condition === "hurt" ? (
          <Notice className="mt-8" title={copy.report.injuredTitle}>
            {copy.report.injuredBody}
          </Notice>
        ) : null}

        <div className="mt-10 flex flex-wrap gap-4">
          {outcome.link ? (
            <Button href={labPath(direction, "/map")} size="hero">
              {copy.receipt.publishedLink}
            </Button>
          ) : null}
          <Button
            variant={outcome.link ? "secondary" : "primary"}
            size="hero"
            onClick={onAgain}
          >
            {copy.receipt.again}
          </Button>
          {state.place ? (
            <Button variant="tertiary" onClick={onAgainSamePlace}>
              {copy.receipt.againSamePlace}
            </Button>
          ) : null}
          <Button variant="tertiary" href={labPath(direction, "/map")}>
            {copy.receipt.backToMap}
          </Button>
        </div>
      </main>
    </div>
  );
}
