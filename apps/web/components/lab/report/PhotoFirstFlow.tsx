"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import Button from "@/components/lab/ui/Button";
import type { LabCopy } from "@/lib/lab/copy";
import type { LabDirection } from "@/lib/lab/directions";
import {
  firstGap,
  forcedOutcome,
  outcomeFor,
  segmentOf,
  sendWarning,
  type Outcome,
  type Step,
} from "@/lib/lab/reportFlow";
import ConditionStep from "./ConditionStep";
import DerivationSeam from "./DerivationSeam";
import FlowShell from "./FlowShell";
import InjuredNotice from "./InjuredNotice";
import PhotoStep from "./PhotoStep";
import PlaceStep from "./PlaceStep";
import Receipt from "./Receipt";
import SendStep from "./SendStep";
import SpeciesStep from "./SpeciesStep";
import { useReportFlow } from "./useReportFlow";

/**
 * The chosen shape: the camera at the top, every question under it, all of it
 * on screen from the first frame.
 *
 * THIS REPLACES A REVEAL. Until the owner saw it, each section appeared only
 * once the one above it was answered, on the argument that a page showing all
 * five at once is the form this redesign is replacing. The owner disagreed, and
 * on the evidence they are right: what made the old page a form was its
 * density, its two-row header, its viewport-tall footer and its demand that a
 * stranger classify an animal before saying anything about it. None of that is
 * "the questions are visible". A reveal answers a different complaint from the
 * one anybody had.
 *
 * What a reveal costs is real and was being paid for nothing. You cannot see
 * what you are in for, so there is no deciding to skip the species question
 * before you have answered three others. You cannot answer out of order, which
 * on a roadside is the normal case — the animal is in front of you and the GPS
 * has not settled. Anything below the fold is a section nobody knows exists, so
 * it needs a scroll-into-view effect to announce itself, and that effect moves
 * the page under a thumb that is already moving it.
 *
 * It keeps the two things the review says photo-first must have: condition is
 * asked before species, so the flow never files an injured animal by inference
 * from what it was, and the species question is skippable. And it keeps the
 * pinned button, which matters MORE on one long page than it did on five short
 * ones — the way out has to be in the same place however far down you are.
 *
 * The one thing still revealed is the injured notice, and that is not a hidden
 * question. It is what the page says back when someone answers "alive, but
 * hurt".
 */
export default function PhotoFirstFlow({
  copy,
  direction,
  flowPath,
  receiptParam,
}: {
  copy: LabCopy;
  direction: LabDirection;
  flowPath: string;
  receiptParam?: string;
}) {
  const flow = useReportFlow();
  const router = useRouter();
  const [sent, setSent] = useState<Outcome | null>(null);
  // The gap this warning was raised against, so answering it clears the warning
  // without anything having to remember to.
  const [nudgedGap, setNudgedGap] = useState<Step | null>(null);

  const state = flow.state;
  const gap = firstGap(state);
  const forced = forcedOutcome(receiptParam);
  const receipt = sent ?? forced;
  const nudged = nudgedGap === gap;

  /** Back to an empty page, and out of a forced receipt if that is how we got here. */
  function startOver(keepPlace: boolean) {
    flow.reset(keepPlace);
    setSent(null);
    setNudgedGap(null);
    if (forced) router.replace(flowPath);
  }

  if (receipt)
    return (
      <>
        <Receipt
          copy={copy}
          direction={direction}
          outcome={receipt}
          state={state}
          onAgain={() => startOver(false)}
          onAgainSamePlace={() => startOver(true)}
        />
        <DerivationSeam
          copy={copy}
          state={state}
          flowPath={flowPath}
          outcome={receipt}
        />
      </>
    );

  const ready = gap === "send";
  const warning = ready ? sendWarning(state) : null;
  const missingWord = {
    photo: null,
    place: copy.report.stepPlace,
    condition: copy.report.stepCondition,
    injured: copy.report.stepCondition,
    species: copy.report.stepSpecies,
    send: null,
  }[gap];

  // The bar says the one thing the page cannot: which question is still open.
  // On a page this long that is the only navigation there is.
  let caption: React.ReactNode = null;
  if (gap === "place") caption = copy.report.placeMissing;
  else if (gap === "injured") caption = copy.report.captionInjured;
  else if (missingWord)
    caption = copy.report.captionMissing.replace("{what}", missingWord);
  else if (warning === "no-photo") caption = copy.report.captionNoPhoto;
  else if (warning === "no-species") caption = copy.report.captionNoSpecies;

  function press() {
    if (ready) {
      setSent(outcomeFor(state));
      return;
    }
    setNudgedGap(gap);
    const target = document.getElementById(gap);
    target?.scrollIntoView({ block: "start" });
    target?.focus();
  }

  const section = "rule-strong mt-12 border-t-2 pt-10";

  return (
    <>
      <FlowShell
        copy={copy}
        direction={direction}
        segment={segmentOf(gap)}
        progress={false}
        caption={caption}
        captionAlert={nudged && !ready}
        // No aside. "The record so far" beside a page that already shows every
        // answer is the same record twice, and the desktop column centres
        // instead — see FlowShell.
        action={
          // One button with one job, from the first frame. The reveal needed a
          // second label here — "continue without a photo" — because skipping
          // the photo was how you got the rest of the page to exist. Nothing
          // has to be unlocked now, so the way out of the form is the only
          // thing this control ever says.
          <Button
            block
            size="hero"
            variant="primary"
            disabled={!ready}
            onClick={press}
            id="lab-flow-action"
          >
            {copy.report.buttonSend}
          </Button>
        }
      >
        <section id="photo" tabIndex={-1} className="scroll-mt-24" style={{ outline: "none" }}>
          <PhotoStep
            copy={copy}
            flow={flow}
            titleId="lab-section-photo"
            help={copy.report.photoOptional}
          />
        </section>

        <section
          id="place"
          tabIndex={-1}
          className={`${section} scroll-mt-24`}
          style={{ outline: "none" }}
        >
          <PlaceStep
            copy={copy}
            flow={flow}
            titleId="lab-section-place"
            heading="h2"
          />
        </section>

        <section
          id="condition"
          tabIndex={-1}
          className={`${section} scroll-mt-24`}
          style={{ outline: "none" }}
        >
          <ConditionStep
            copy={copy}
            flow={flow}
            titleId="lab-section-condition"
            heading="h2"
          />
          {/* The one thing still revealed, and not a question: what the page
              says back when someone answers "alive, but hurt". */}
          {state.condition === "hurt" ? (
            <div id="injured" className="mt-10 scroll-mt-24">
              <InjuredNotice
                copy={copy}
                titleId="lab-section-injured"
                heading="h2"
                action={
                  state.injuredAck ? null : (
                    <Button variant="secondary" onClick={flow.ackInjured}>
                      {copy.report.injuredAck}
                    </Button>
                  )
                }
              />
            </div>
          ) : null}
        </section>

        <section
          id="species"
          tabIndex={-1}
          className={`${section} scroll-mt-24`}
          style={{ outline: "none" }}
        >
          <SpeciesStep
            copy={copy}
            flow={flow}
            titleId="lab-section-species"
            heading="h2"
          />
        </section>

        {/* A `div`, not a `section`: with the review rows gone this is an
            optional note, an optional address and the privacy sentence. Giving
            it an `h2` of the same weight as the four questions would put a
            fifth question in the outline that nobody has to answer. */}
        <div id="send" tabIndex={-1} className={`${section} scroll-mt-24`} style={{ outline: "none" }}>
          <SendStep
            copy={copy}
            flow={flow}
            titleId="lab-section-send"
            heading="h2"
            summary={false}
          />
        </div>
      </FlowShell>
      <DerivationSeam copy={copy} state={state} flowPath={flowPath} />
    </>
  );
}
