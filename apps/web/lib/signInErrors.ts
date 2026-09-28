/**
 * What a failed sign-in step means for the reader, as a message key.
 *
 * Supabase's own messages are raw English written for a developer — "For
 * security purposes, you can only request this after 47 seconds" — so they are
 * never shown. What is worth telling apart is what each failure asks the
 * reader to do next: wait, fix the code, or just try again.
 */
export type SignInFailure =
  | "failed"
  | "tooMany"
  | "wrongCode"
  | "verifyFailed"
  | "googleFailed";

/** Asking for an email: rate limited, or anything else. */
export function sendFailure(status: number | undefined): SignInFailure {
  return status === 429 ? "tooMany" : "failed";
}

/**
 * Checking a code.
 *
 * Supabase answers 403 "otp_expired" for a wrong code and an expired one alike,
 * so any 4xx other than rate limiting is "that code will not work". A 5xx, or
 * no status at all (supabase-js reports a request that never got an answer as
 * status 0), is not the reader's mistake, and calling their code wrong would
 * send them looking for a typo that is not there.
 */
export function verifyFailure(status: number | undefined): SignInFailure {
  if (status === 429) return "tooMany";
  if (status && status >= 400 && status < 500) return "wrongCode";
  return "verifyFailed";
}
