"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Button from "@/components/lab/ui/Button";
import { useRouter } from "@/i18n/navigation";
import type { LabCopy } from "@/lib/lab/copy";
import type { LabDirection } from "@/lib/lab/directions";
import {
  STEPS,
  canReach,
  firstGap,
  forcedOutcome,
  missingFor,
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
 * One question per screen, the step in the hash.
 *
 * The hash is what makes the browser's Back button mean "the previous
 * question" instead of "leave the form", which on a phone is the button people
 * actually use. It also survives a reload, and it is what the summary rows on
 * the send screen link to: the whole row is a link to `#place`, and arriving
 * there swaps the screen.
 *
 * A hash typed past a gap lands on the gap. Every step is re-checked against
 * the answers on every render, so `#send` on a fresh page is the photo screen
 * and not an empty summary of nothing.
 *
 * Focus moves to the step when the step changes — to the region rather than to
 * the heading itself, so it is announced with its name and the next Tab lands
 * on the first control rather than somewhere in the middle of the screen.
 */
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const readHash = () => window.location.hash;
const readNothing = () => "";

export default function StepperFlow({
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
  // The step this warning belongs to, rather than a boolean somebody has to
  // remember to clear: moving on clears it by arithmetic.
  const [nudgedStep, setNudgedStep] = useState<Step | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const shown = useRef<Step | null>(null);
  const photoCount = useRef(0);

  const state = flow.state;

  // The hash is the source of truth for which screen is on, and it is read
  // rather than mirrored into state. `useSyncExternalStore` is the whole
  // subscription: the browser owns the value, this component reads it, and the
  // step is derived from it and the answers on every render. Nothing has to be
  // kept in step with anything.
  const hash = useSyncExternalStore(subscribeHash, readHash, readNothing);
  const raw = hash.replace("#", "");
  const wanted = (STEPS as readonly string[]).includes(raw)
    ? (raw as Step)
    : "photo";
  // A hash typed or pasted past a gap lands on the gap, and an answer taken
  // back closes the steps behind it.
  const step = canReach(state, wanted) ? wanted : firstGap(state);
  const nudged = nudgedStep === step;

  // `?receipt=published|held|queued`, so all three endings can be seen without
  // acting each one out.
  const forced = forcedOutcome(receiptParam);
  const receipt = sent ?? forced;

  useEffect(() => {
    // Focus moves to the step, not to the heading: a focused region is
    // announced with its own name, and the next Tab lands on the first control
    // rather than in the middle of the screen.
    //
    // Compared against the step that was last SHOWN rather than a "have I run
    // before" flag. In development React runs every effect twice, and a flag
    // would be consumed by the discarded run and then steal focus on arrival —
    // which is how the first screenshot of this flow came back with a ring
    // around the whole page.
    const previous = shown.current;
    shown.current = step;
    if (previous !== null && previous !== step) region.current?.focus();
  }, [step]);

  // The first photo is the answer to the first question, so the flow goes on
  // without a Next tap. No timer and no confirmation: the shutter already was
  // the confirmation.
  useEffect(() => {
    const had = photoCount.current;
    photoCount.current = state.photos.length;
    if (had === 0 && state.photos.length === 1 && step === "photo")
      window.location.hash = "place";
  }, [state.photos.length, step]);

  function go(next: Step) {
    window.location.hash = next;
  }

  /** Back to an empty form, and out of a forced receipt if that is how we got here. */
  function startOver(keepPlace: boolean) {
    flow.reset(keepPlace);
    setSent(null);
    if (forced) router.replace(flowPath);
    go("photo");
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

  const titleId = `lab-step-${step}`;
  // On the injured screen the pinned button is the acknowledgement itself, so
  // nothing is missing: marking it `aria-disabled` would tell a screen reader —
  // and every test runner — that the one control on screen cannot be used.
  const missing = step === "injured" ? null : missingFor(state, step);
  const warning = step === "send" ? sendWarning(state) : null;

  const missingWord = missing
    ? {
        place: copy.report.stepPlace,
        condition: copy.report.stepCondition,
        injured: copy.report.stepCondition,
        species: copy.report.stepSpecies,
      }[missing]
    : null;

  let caption: React.ReactNode = null;
  if (step === "place" && missing) caption = copy.report.placeMissing;
  else if (missingWord)
    caption = copy.report.captionMissing.replace("{what}", missingWord);
  else if (warning === "no-photo") caption = copy.report.captionNoPhoto;
  else if (warning === "no-species") caption = copy.report.captionNoSpecies;

  const label =
    step === "send"
      ? copy.report.buttonSend
      : step === "injured"
        ? copy.report.injuredAck
        : step === "photo" && state.photos.length === 0
          ? copy.report.photoSkip
          : copy.report.next;

  function press() {
    if (step === "send") {
      setSent(outcomeFor(state));
      return;
    }
    if (step === "injured") {
      flow.ackInjured();
      go("species");
      return;
    }
    if (missing) {
      // Never dead: the press is answered, with the reason and with focus back
      // on the question. A control that ignores a tap teaches people the page
      // is broken.
      setNudgedStep(step);
      region.current?.focus();
      return;
    }
    const order = STEPS.filter(
      (candidate) => candidate !== "injured" || state.condition === "hurt",
    );
    const next = order[order.indexOf(step) + 1];
    if (next) go(next);
  }

  const aside =
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
    ) : (
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer.files.length)
            void flow.addFiles(event.dataTransfer.files);
        }}
        data-surface="plate"
        className="rounded-(--radius-sign) flex h-64 items-center justify-center border-2 border-(--fg) bg-(--ground) px-6 text-center text-(--fg)"
      >
        <p className="t-body">{copy.report.photoDropZone}</p>
      </div>
    );

  return (
    <>
      <FlowShell
        copy={copy}
        direction={direction}
        segment={segmentOf(step)}
        onBack={step === "photo" ? undefined : () => window.history.back()}
        caption={caption}
        captionAlert={nudged}
        aside={aside}
        action={
          <Button
            block
            size="hero"
            // "ember means press here", and on the photo step the thing to
            // press is the camera. While there is no photograph this pinned
            // control says "continue without one" — so painting it ember made
            // the loudest element on a screen headed 先拍一張 the argument
            // against the heading. It steps back to the outline until there is
            // something to go forward with.
            variant={
              step === "photo" && state.photos.length === 0
                ? "tertiary"
                : "primary"
            }
            disabled={Boolean(missing)}
            onClick={press}
            id="lab-flow-action"
          >
            {label}
          </Button>
        }
      >
        {/* The region is focused when the step changes and then announced by
            its heading, so it takes no ring of its own: an ember rectangle
            around the whole screen on every step is not a focus indicator, it
            is a distraction, and the first control inside still has one. */}
        <div
          ref={region}
          tabIndex={-1}
          aria-labelledby={titleId}
          style={{ outline: "none" }}
        >
          {step === "photo" ? (
            <PhotoStep copy={copy} flow={flow} titleId={titleId} />
          ) : step === "place" ? (
            <PlaceStep
              copy={copy}
              flow={flow}
              titleId={titleId}
              onAdvance={() => go("condition")}
            />
          ) : step === "condition" ? (
            <ConditionStep
              copy={copy}
              flow={flow}
              titleId={titleId}
              onAdvance={(condition) =>
                go(condition === "hurt" ? "injured" : "species")
              }
            />
          ) : step === "injured" ? (
            <InjuredNotice copy={copy} titleId={titleId} />
          ) : step === "species" ? (
            <SpeciesStep
              copy={copy}
              flow={flow}
              titleId={titleId}
              onAdvance={() => go("send")}
            />
          ) : (
            <SendStep copy={copy} flow={flow} titleId={titleId} />
          )}
        </div>
      </FlowShell>
      <DerivationSeam copy={copy} state={state} flowPath={flowPath} />
    </>
  );
}
