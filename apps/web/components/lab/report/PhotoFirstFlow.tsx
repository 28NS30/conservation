"use client";

import { useEffect, useRef, useState } from "react";
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
import RecordSummary from "./RecordSummary";
import SendStep from "./SendStep";
import SpeciesStep from "./SpeciesStep";
import { useReportFlow } from "./useReportFlow";

/**
 * The runner-up shape: the same opening screen, then one page that grows.
 *
 * It shares screen one, the controls, the frame, the pinned button and the
 * derivation with the stepper, so the only thing the owner is being asked to
 * compare is this: screens that swap, or sections that pile up. Everything else
 * being identical is what makes that a fair question rather than a preference
 * for whichever one was built better.
 *
 * It keeps the two things the review says photo-first must gain to be viable:
 * condition is asked before species, so the flow never files an injured animal
 * by inference from what it was, and the species question is skippable. And it
 * keeps the one thing a single page tends to lose: a pinned button, so the way
 * out is in the same place whether the page is one section long or five.
 *
 * A section appears only once the one above it has been answered. A page that
 * shows all five at once is the form this redesign is replacing.
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
  const [skipped, setSkipped] = useState(false);
  const [sent, setSent] = useState<Outcome | null>(null);
  // The gap this warning was raised against, so answering it clears the warning
  // without anything having to remember to.
  const [nudgedGap, setNudgedGap] = useState<Step | null>(null);
  const revealed = useRef<Step | null>(null);

  const state = flow.state;
  const gap = firstGap(state);
  // The photo answers the first question, so the page opens itself — derived
  // rather than set, because "has the first question been dealt with" is a fact
  // about the answers and not a second thing to keep in step with them.
  const opened = skipped || state.photos.length > 0;
  const forced = forcedOutcome(receiptParam);
  const receipt = sent ?? forced;
  const nudged = nudgedGap === gap;

  // When a new section appears, bring it into view. A section that unfolds
  // below the fold is a section nobody knows appeared, and the pinned button
  // would then be naming something they cannot see.
  useEffect(() => {
    if (!opened) return;
    if (revealed.current === gap) return;
    const previous = revealed.current;
    revealed.current = gap;
    if (previous === null) return;
    const target = document.getElementById(gap);
    if (!target) return;
    const still = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target.scrollIntoView({
      behavior: still ? "auto" : "smooth",
      block: "start",
    });
  }, [gap, opened]);

  /** Back to an empty page, and out of a forced receipt if that is how we got here. */
  function startOver(keepPlace: boolean) {
    flow.reset(keepPlace);
    setSent(null);
    setSkipped(false);
    revealed.current = null;
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

  // Nothing is missing on the opening screen, so nothing is said above the
  // button. The help line that explains the auto-advance belongs beside the
  // photo controls, not in the bar.
  let caption: React.ReactNode = null;
  if (!opened) caption = null;
  else if (gap === "place") caption = copy.report.placeMissing;
  else if (gap === "injured") caption = copy.report.captionInjured;
  else if (missingWord)
    caption = copy.report.captionMissing.replace("{what}", missingWord);
  else if (warning === "no-photo") caption = copy.report.captionNoPhoto;
  else if (warning === "no-species") caption = copy.report.captionNoSpecies;

  function press() {
    if (!opened) {
      setSkipped(true);
      revealed.current = null;
      return;
    }
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
        segment={segmentOf(opened ? gap : "photo")}
        caption={caption}
        captionAlert={nudged && opened && !ready}
        aside={
          state.photos.length > 0 || state.place || state.condition ? (
            <div>
              {state.photos[0] ? (
                <div
                  data-surface="plate"
                  className="rounded-(--radius-sign) aspect-4/3 w-full overflow-hidden bg-(--ground)"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={state.photos[0].url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : null}
              <h2 className="t-note t-label mt-6 font-bold text-(--fg-quiet)">
                {copy.report.recordSoFar}
              </h2>
              <RecordSummary copy={copy} state={state} className="mt-2" />
            </div>
          ) : undefined
        }
        action={
          <Button
            block
            size="hero"
            disabled={opened && !ready}
            onClick={press}
            id="lab-flow-action"
          >
            {!opened && state.photos.length === 0
              ? copy.report.photoSkip
              : copy.report.buttonSend}
          </Button>
        }
      >
        <section id="photo" tabIndex={-1} className="scroll-mt-24" style={{ outline: "none" }}>
          <PhotoStep copy={copy} flow={flow} titleId="lab-section-photo" />
        </section>

        {opened ? (
          <>
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

            {state.place ? (
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
                {state.condition === "hurt" ? (
                  <div id="injured" className="mt-10 scroll-mt-24">
                    <InjuredNotice
                      copy={copy}
                      titleId="lab-section-injured"
                      heading="h2"
                      action={
                        state.injuredAck ? null : (
                          <Button
                            variant="secondary"
                            onClick={flow.ackInjured}
                          >
                            {copy.report.injuredAck}
                          </Button>
                        )
                      }
                    />
                  </div>
                ) : null}
              </section>
            ) : null}

            {state.condition && (state.condition !== "hurt" || state.injuredAck) ? (
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
            ) : null}

            {state.species ? (
              <section
                id="send"
                tabIndex={-1}
                className={`${section} scroll-mt-24`}
                style={{ outline: "none" }}
              >
                <SendStep
                  copy={copy}
                  flow={flow}
                  titleId="lab-section-send"
                  heading="h2"
                />
              </section>
            ) : null}
          </>
        ) : null}
      </FlowShell>
      <DerivationSeam copy={copy} state={state} flowPath={flowPath} />
    </>
  );
}
