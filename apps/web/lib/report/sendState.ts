/**
 * What the report pages' main button does, and what it says is missing.
 *
 * SAVING IS NOT SENDING. The button used to be one thing, "send", and it was
 * disabled until Cloudflare Turnstile produced a token. Turnstile's script
 * comes from challenges.cloudflare.com, so on a page opened with no signal it
 * never loads, never solves, and the button never woke up: a reporter on a
 * mountain road — the case the offline queue exists for — was shown "complete
 * the check above" above an empty space, and could neither send nor save.
 * Production has Turnstile keys, so this was live; local development has
 * none, so nothing a developer ran could see it.
 *
 * A token is only needed to SEND. Saving on the phone needs a place and
 * finished photographs, and the queue fetches its own token when it actually
 * sends (QueueBanner, lib/offline/flush.ts). So:
 *
 *   - offline, the main button IS "Save on this phone", and needs no token;
 *   - online with no token after TOKEN_PATIENCE_MS, a second button offers to
 *     save instead, while the first keeps waiting — someone halfway through a
 *     challenge is not sent down the other path;
 *   - a send still running after SEND_PATIENCE_MS offers the same, and saving
 *     then abandons the send under the same nonce, so if both land the server
 *     keeps one report (the duplicate check keys on the nonce).
 *
 * The timings are docs/redesign/report-flow.md's. Pure, and deliberately so:
 * the defect was a condition in a JSX attribute that no test could reach, and
 * a function can be walked case by case.
 */

/** How long to wait for a token before offering to save instead. */
export const TOKEN_PATIENCE_MS = 8_000;
/** How long a send may run before offering to save instead. */
export const SEND_PATIENCE_MS = 12_000;

/** A key under `report`, naming the first thing still missing. */
export type Blocker =
  | "preparingPhotos"
  | "needCondition"
  | "needLocation"
  | "needChallenge";

export type SendControls = {
  /** What the main button does. */
  primary: "send" | "save";
  disabled: boolean;
  /** The first unmet requirement, in the order someone meets them. */
  blocker: Blocker | null;
  /** The second button, when there is one, and why it is there. */
  backup: "noToken" | "slow" | null;
};

export function sendControls(s: {
  online: boolean;
  turnstileEnabled: boolean;
  hasToken: boolean;
  hasLocation: boolean;
  preparing: boolean;
  /** The roadkill page's dead-or-hurt question is still unanswered. */
  needsCondition: boolean;
  /** A send (or a save) is in progress. */
  busy: boolean;
  /** No token has arrived for TOKEN_PATIENCE_MS. */
  tokenSlow: boolean;
  /** The send in progress has run for SEND_PATIENCE_MS. */
  sendSlow: boolean;
}): SendControls {
  // What the report itself needs, whichever way it leaves: a stored report
  // must still have a place and a category, and a photo still being shrunk is
  // not yet a photo that can be stored.
  const missing: Blocker | null = s.preparing
    ? "preparingPhotos"
    : s.needsCondition
      ? "needCondition"
      : !s.hasLocation
        ? "needLocation"
        : null;

  if (!s.online) {
    // No challenge here, on purpose: this is the whole fix.
    return {
      primary: "save",
      disabled: s.busy || missing !== null,
      blocker: missing,
      backup: null,
    };
  }

  const needToken = s.turnstileEnabled && !s.hasToken;
  const blocker = missing ?? (needToken ? "needChallenge" : null);
  const backup: SendControls["backup"] = s.busy
    ? s.sendSlow
      ? "slow"
      : null
    : missing === null && needToken && s.tokenSlow
      ? "noToken"
      : null;

  return {
    primary: "send",
    disabled: s.busy || blocker !== null,
    blocker,
    backup,
  };
}
