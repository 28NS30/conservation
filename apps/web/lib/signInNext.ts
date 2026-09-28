/**
 * Where to send someone once they have signed in, and how that survives the
 * trip through their inbox.
 *
 * Pure and dependency-free on purpose: the login page (server and client), the
 * callback route and the unit tests all import it, and the one rule it holds —
 * this site's own paths only — has to be the same rule in all three.
 */

/**
 * The cookie that carries the return path through an email link or Google.
 *
 * Why a cookie rather than `?next=` on the callback URL: production's redirect
 * allow-list names the callback exactly, with no query string. A redirect URL
 * that is not on the list is not an error Supabase reports — it silently sends
 * the person to the Site URL instead, so a `?next=` there would work on one
 * project and quietly drop people on the home page on another.
 *
 * Why a cookie rather than sessionStorage: sessionStorage belongs to one tab,
 * and an email link opens in a new one. The link itself only works in the
 * browser that asked for it (the PKCE code verifier is a cookie in that
 * browser), so a cookie reaches exactly as far as the sign-in it serves — no
 * further, and no less far.
 *
 * Scoped to the callback's path, so it rides along on no other request.
 */
export const NEXT_COOKIE = "sign_in_next";

/** As long as the link in the email stays usable (Supabase's default is an hour). */
export const NEXT_COOKIE_MAX_AGE = 60 * 60;

/** The only path the cookie is sent to. */
export const NEXT_COOKIE_PATH = "/auth/callback";

/**
 * A throwaway origin to resolve against. Nothing is fetched from it; it exists
 * so "did this stay on the same origin" can be asked without knowing the real
 * one, which the login page's server render does not reliably have.
 */
const PROBE = "http://return-path.invalid";

/**
 * `raw` as a path on this site, or null if it is anything else.
 *
 * The callback used to accept anything that started with `/` and not `//`.
 * That misses `/\evil.example`: browsers treat a backslash in a URL as a slash,
 * so the redirect went to `//evil.example` and the sign-in link became an open
 * redirect wearing this site's name. Rather than list the tricks (backslashes,
 * tabs and newlines the URL parser strips, encoded slashes), the path is
 * resolved the way a browser would resolve it and kept only if it is still on
 * the origin it started from.
 *
 * Staying on the origin is not enough on its own, because what is returned is
 * the path as re-serialised, not the path as given, and resolving can change
 * its shape. `/.//evil.example` is on the probe origin — a path whose first
 * segment is `.` and second is empty — but removing the dot leaves
 * `//evil.example`, which a browser reads as a different host. The first
 * version of this function returned exactly that, and all three places that use
 * the answer (the login page's redirect for someone already signed in, the code
 * form's `location.replace`, the callback's Location header) sent the reader to
 * it. So the answer is also refused if it begins with two slashes. After
 * parsing, that is the only way left for a path to leave: the parser has turned
 * every backslash into a slash and dropped every tab and newline.
 *
 * Which also makes the answer a fixed point — `safeNextPath(out) === out` — so
 * checking it again, as the callback does with the cookie, never changes it.
 *
 * Paths that are part of signing in are refused too: returning someone to the
 * login form after they have signed in reads as a failure, and returning them
 * to the callback would try to spend a code twice.
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  if (!raw.startsWith("/")) return null;
  let url: URL;
  try {
    url = new URL(raw, PROBE);
  } catch {
    return null;
  }
  if (url.origin !== PROBE) return null;
  if (url.pathname.startsWith("//")) return null;
  if (isSignInPath(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** /auth/…, /login and /<locale>/login. */
function isSignInPath(pathname: string): boolean {
  return (
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?login(?:\/|$)/.test(pathname)
  );
}

/**
 * The sign-in page in the language of the page someone is returning to.
 *
 * The callback lives outside [locale], so it cannot know which language the
 * person was reading — but the path they are going back to can. Without this an
 * English reader whose link had expired was sent to the Chinese form to try
 * again.
 */
export function loginPathFor(next: string | null): string {
  return next && /^\/en(?:[/?#]|$)/.test(next) ? "/en/login" : "/login";
}

/** Read the cookie's value back, tolerating anything a browser might hand over. */
export function nextFromCookie(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return safeNextPath(decodeURIComponent(value));
  } catch {
    return null;
  }
}
