/**
 * Turning what went wrong into something the reporter can act on.
 *
 * Every failure on the submission path used to reach the screen as itself: a
 * snake_case code from the API (`challenge_failed`, `taxon_not_found`), an
 * English sentence assembled in the client (`upload signing failed (500)`), or
 * once the literal string `report.queueFailed`, because a message key was
 * interpolated instead of translated. A Taiwanese reporter standing beside a
 * dead animal was shown a developer's identifier and no idea what to do next.
 *
 * Worse, all of them landed in the same box at the bottom of the form, so a
 * photograph that failed to upload was reported half a screen away from the
 * photographs, and a species that no longer exists was reported nowhere near
 * the species picker.
 *
 * So two questions, answered separately: which sentence, and where it goes.
 * The codes themselves are still worth having — they go to `console.error`, for
 * whoever is reading a session replay or a bug report.
 */

/**
 * A failure that carries the server's own word for what happened.
 *
 * `Error.message` is deliberately the code and nothing else: the old code paths
 * put prose in there and then rendered it, and a message that is only ever an
 * identifier cannot be mistaken for something to show a person.
 */
export class ReportError extends Error {
  readonly code: string;
  /** HTTP status, when the failure came from a response. */
  readonly status?: number;

  constructor(code: string, status?: number) {
    super(code);
    this.name = "ReportError";
    this.code = code;
    this.status = status;
  }
}

/** A key under `report.errors`. */
export type ErrorKey =
  | "rate_limited"
  | "challenge_failed"
  | "photo"
  | "photoUnreadable"
  | "taxon_not_found"
  | "validation_failed"
  | "server";

/** Which part of the form the sentence belongs beside. */
export type ErrorSlot = "photo" | "species" | "form";

/**
 * The client's own word for a photograph it could not read at all — a file the
 * browser will not decode, rather than one that failed to reach the bucket.
 */
export const PHOTO_UNREADABLE = "photo_unreadable";
/** The client's own word for an upload that did not land. */
export const PHOTO_UPLOAD_FAILED = "photo_upload_failed";

/**
 * Which sentence a code gets.
 *
 * Several codes share one: `photo_missing`, `photo_too_large`,
 * `photo_bad_type`, `sign_failed`, `bad_count` and `bad_request` all mean the
 * photographs did not make it, and the reporter's options are the same in every
 * case — try again, or send without them. Distinguishing them on screen would
 * be describing our plumbing to someone who cannot repair it.
 *
 * Anything unrecognised is `server`, including an old queued row holding one of
 * the English sentences this module replaced. That sentence says the report was
 * not sent and the entries are still there, which is the safe thing to say when
 * we do not know what happened.
 */
export function errorKey(code: string | null | undefined): ErrorKey {
  if (code === PHOTO_UNREADABLE) return "photoUnreadable";
  if (code === "rate_limited") return "rate_limited";
  if (code === "challenge_failed") return "challenge_failed";
  if (code === "taxon_not_found") return "taxon_not_found";
  if (code === "validation_failed") return "validation_failed";
  if (
    code === PHOTO_UPLOAD_FAILED ||
    code === "sign_failed" ||
    code === "bad_count" ||
    code === "bad_request" ||
    (typeof code === "string" && code.startsWith("photo_"))
  )
    return "photo";
  return "server";
}

/**
 * Where it goes.
 *
 * Beside the control that failed, so that "try again, or take the photos off"
 * is read within reach of the button that takes them off.
 */
export function slotOf(key: ErrorKey): ErrorSlot {
  if (key === "photo" || key === "photoUnreadable") return "photo";
  if (key === "taxon_not_found") return "species";
  return "form";
}

/** Everything the screen needs from a failure, and nothing it does not. */
export function describeFailure(code: string | null | undefined): {
  key: ErrorKey;
  slot: ErrorSlot;
} {
  const key = errorKey(code);
  return { key, slot: slotOf(key) };
}
