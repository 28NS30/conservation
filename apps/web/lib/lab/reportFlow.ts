import { isInTaiwanBounds } from "@conservation/shared";
import type { Condition, SpeciesAnswer } from "./deriveCategory";

/**
 * The report flow's state, its order, and what it would be told after sending.
 *
 * Pure and framework-free, so the two proofs — a stepper that swaps screens and
 * a photo-first page that reveals sections — are the same flow rendered twice
 * rather than two flows that will drift apart in a day. Which of them the owner
 * prefers is a question about the shape of the screen, and that question is
 * only fair if everything underneath is identical.
 *
 * Nothing here talks to the network. The proof never POSTs: the send button
 * reads the outcome table below and shows the receipt it gives, which is the
 * one thing about today's form that is actually wrong rather than merely ugly —
 * it tells a reporter with no photo that their record is published when it is
 * held for review, and then links them to a page that 404s.
 */
export type LatLng = { lat: number; lng: number };

export type Place = LatLng & {
  /** Metres, from the device. A pin dropped on a map has no accuracy at all. */
  accuracyM: number | null;
  source: "device" | "photo" | "map";
};

export type Photo = {
  id: string;
  /** An object URL over the downscaled, metadata-free blob `preparePhoto` made. */
  url: string;
  width: number;
  height: number;
  /** EXIF GPS from the original — offered as a place, never applied silently. */
  gps: LatLng | null;
  /** EXIF DateTimeOriginal, as epoch ms, device-local. */
  takenAt: number | null;
};

export type FlowState = {
  photos: Photo[];
  place: Place | null;
  condition: Condition | null;
  /** The hurt notice has been read. Not an answer; an acknowledgement. */
  injuredAck: boolean;
  species: SpeciesAnswer | null;
  note: string;
  email: string;
};

export const EMPTY_FLOW: FlowState = {
  photos: [],
  place: null,
  condition: null,
  injuredAck: false,
  species: null,
  note: "",
  email: "",
};

/* ------------------------------------------------------------------ *
 * Order
 * ------------------------------------------------------------------ */

export const STEPS = [
  "photo",
  "place",
  "condition",
  "injured",
  "species",
  "send",
] as const;

export type Step = (typeof STEPS)[number];

/**
 * The five screens, plus the sixth that only exists for one answer.
 *
 * The injured notice is not a step anyone is walked through — it appears
 * because somebody said the animal was alive and hurt, and it exists to say
 * before they send that nobody is coming. It shares the third progress segment
 * rather than adding a sixth, because the progress bar is a promise about how
 * much is left and answering "hurt" does not make the form longer.
 */
export function stepsFor(state: FlowState): Step[] {
  return STEPS.filter(
    (step) => step !== "injured" || state.condition === "hurt",
  );
}

/** The five segments the progress bar draws, in order. */
export const SEGMENTS = ["photo", "place", "condition", "species", "send"] as const;

export function segmentOf(step: Step): (typeof SEGMENTS)[number] {
  return step === "injured" ? "condition" : step;
}

/** Has this step been given what it needs? Photo is optional and always true. */
export function isAnswered(state: FlowState, step: Step): boolean {
  switch (step) {
    case "photo":
      return true;
    case "place":
      return state.place !== null;
    case "condition":
      return state.condition !== null;
    case "injured":
      return state.injuredAck;
    case "species":
      return state.species !== null;
    case "send":
      return false;
  }
}

/**
 * The earliest step that still needs something, which is as far as anyone may
 * go. A hash typed or pasted past a gap lands on the gap rather than on a
 * screen whose question has already been skipped.
 */
export function firstGap(state: FlowState): Step {
  const steps = stepsFor(state);
  return steps.find((step) => !isAnswered(state, step)) ?? "send";
}

/** Is `step` reachable given what has been answered so far? */
export function canReach(state: FlowState, step: Step): boolean {
  const steps = stepsFor(state);
  const gap = steps.indexOf(firstGap(state));
  const want = steps.indexOf(step);
  return want >= 0 && want <= gap;
}

/**
 * What the pinned button has to name. `null` means nothing is missing, which is
 * the only case in which the button is simply an action.
 *
 * Returned as a key rather than a sentence: the caller owns the words, and this
 * file is imported by both locales at once.
 */
export function missingFor(
  state: FlowState,
  step: Step,
): "place" | "condition" | "injured" | "species" | null {
  if (step === "send") {
    const gap = firstGap(state);
    return gap === "send" || gap === "photo" ? null : gap;
  }
  return isAnswered(state, step) || step === "photo"
    ? null
    : (step as "place" | "condition" | "injured" | "species");
}

/* ------------------------------------------------------------------ *
 * What the reporter is told afterwards
 * ------------------------------------------------------------------ */

export type Outcome = {
  kind: "published" | "held" | "queued";
  /** Why it is held. Held receipts differ only in this sentence. */
  reason: "no-species" | "no-photo" | "review" | null;
  /** `taxon` is the blur the species' own sensitivity sets. */
  precision: "taxon" | "coarse_10km";
  /** A link to the record is offered only when the record is public. */
  link: boolean;
};

/**
 * A URL in a free-text field is the shape of spam, so a report carrying one
 * goes to a human whatever else is true of it. Deliberately crude: this is the
 * prototype's stand-in for the server's own check, and the point on screen is
 * that the receipt changes, not how the decision is made.
 */
export function noteHasLink(note: string): boolean {
  return /(https?:\/\/|www\.)/i.test(note);
}

/**
 * report-flow.md's outcome table, all four rows, plus the two overrides.
 *
 * Status is independent of category: all four categories are classifiable, so
 * what decides whether a record appears on the map immediately is whether there
 * is a photo to check it against and a name to blur it by. A record with
 * neither is held AND published at 10 km when it eventually clears, which is a
 * change from today, where such a record is published at its exact coordinates.
 */
export function outcomeFor(
  state: FlowState,
  { offline = false }: { offline?: boolean } = {},
): Outcome {
  if (offline)
    return { kind: "queued", reason: null, precision: "coarse_10km", link: false };

  const named = state.species?.kind === "named";
  const hasPhoto = state.photos.length > 0;
  const precision = named ? ("taxon" as const) : ("coarse_10km" as const);

  const outside =
    state.place !== null && !isInTaiwanBounds(state.place.lng, state.place.lat);
  if (outside || noteHasLink(state.note))
    return { kind: "held", reason: "review", precision, link: false };

  if (hasPhoto && named)
    return { kind: "published", reason: null, precision, link: true };

  // A photo with no name waits for an identification; anything without a photo
  // waits for a person, named or not.
  return {
    kind: "held",
    reason: hasPhoto ? "no-species" : "no-photo",
    precision,
    link: false,
  };
}

/**
 * The one line above the send button. It warns and never promises: "this will
 * be published" is not something the client can know, and today's form saying
 * it anyway is the defect this whole chapter exists to remove.
 */
export function sendWarning(
  state: FlowState,
): "no-photo" | "no-species" | null {
  if (state.photos.length === 0) return "no-photo";
  if (state.species?.kind !== "named") return "no-species";
  return null;
}

/** `?receipt=published|held|queued`, so all three can be seen without acting them out. */
export function forcedOutcome(value: string | undefined): Outcome | null {
  if (value === "published")
    return { kind: "published", reason: null, precision: "taxon", link: true };
  if (value === "held")
    return { kind: "held", reason: "no-photo", precision: "coarse_10km", link: false };
  if (value === "queued")
    return { kind: "queued", reason: null, precision: "coarse_10km", link: false };
  return null;
}
