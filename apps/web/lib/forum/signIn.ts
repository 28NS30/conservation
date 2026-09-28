import { signInHref } from "@/components/auth/signInHref";

/**
 * Where "sign in" goes from a forum page: the sign-in page, carrying the page
 * the reader was on as `?next=`, so someone who signs in to reply comes back
 * to the thread they were reading rather than to the home page.
 *
 * `path` is the forum path without its locale ("/community/t/…");
 * signInHref() puts the locale back the way the browser shows it, and the
 * sign-in flow checks that `next` is this site's own path (lib/signInNext.ts).
 */
export function forumSignInHref(locale: string, path: string) {
  return signInHref(locale, path);
}
