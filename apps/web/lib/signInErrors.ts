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
  | "refused"
  | "notOpen"
  | "tooMany"
  | "wrongCode"
  | "verifyFailed"
  | "googleFailed";

/**
 * Asking for an email.
 *
 * A 4xx other than rate limiting is Supabase declining this address, and
 * asking again will be declined again. These used to share "try again
 * shortly" with outages, which sent people round a loop that could not end.
 *
 * One refusal is told apart, because until the project has its own mail
 * server it is what every member of the public gets: Supabase's built-in
 * sender only writes to the project's own team, and answers anyone else with
 * `email_address_not_authorized`. That is not the reader's mistake and no
 * other address of theirs will fare better, so they are told it is not open
 * yet — and that reporting never needed it. Any other 4xx (a malformed
 * address, most often) points them back at the address.
 *
 * 408 is the exception, a timeout wearing a 4xx. It, a 5xx, and no answer at
 * all (status 0) are the failures that waiting can fix.
 */
export function sendFailure(status: number | undefined, code?: string): SignInFailure {
  if (status === 429) return "tooMany";
  if (status && status >= 400 && status < 500 && status !== 408)
    return code === "email_address_not_authorized" ? "notOpen" : "refused";
  return "failed";
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
