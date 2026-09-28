/**
 * Where "sign in" goes from a forum page.
 *
 * Plain /login for now. The sign-in rebuild (PR #78: a 6-digit code, and a
 * `?next=` return path through lib/signInNext.ts) had not reached main when
 * the forum was written, and /login on main ignores a return path. Once it
 * lands this should return `signInHref(locale, path)` from
 * components/auth/signInHref.ts, so someone who signs in to reply comes back
 * to the thread they were reading instead of the home page. The arguments are
 * already passed for that reason.
 */
export function forumSignInHref(_locale: string, _path: string): string {
  return "/login";
}
