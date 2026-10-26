/**
 * How the Supabase session cookie is written, by the server and the browser
 * alike.
 *
 * Until October 2026 it was written with @supabase/ssr's defaults: no Secure
 * flag, and 400 days to live. Without Secure, a browser that has not kept the
 * site's HSTS (an in-app browser can lose it with its cache) sends the session
 * with any plain http request to the host, in the clear; and a moderator's
 * session reads exact coordinates.
 *
 *   - **Secure where the site is https.** On the server that is production
 *     (VERCEL_ENV, the test `refusesPasswordSessions` in ./proxy.ts uses); in
 *     the browser it is the page's own scheme, since the browser cannot read
 *     VERCEL_ENV and a production page is only ever https. Not on a laptop's
 *     http://localhost, where a browser that does not count localhost as secure
 *     would refuse the cookie and nobody could stay signed in.
 *   - **SameSite=Lax**, the library's default, written down so it cannot drift:
 *     the cookie still arrives when someone follows a link to the site, which
 *     is how a sign-in link from the email works, and not on another site's
 *     form post.
 *   - **Not HttpOnly**, and it must not be. The browser client keeps the
 *     session in this cookie, and the page reads it to say who a report saved
 *     on the phone belongs to (./storedSession.ts).
 *   - **30 days**, where the library gives 400. The cookie is written again
 *     every time the session is renewed, about hourly while someone is using
 *     the site, so this is how long a browser left alone stays signed in: a
 *     month between visits, then an emailed code. A school computer someone
 *     forgot to sign out of does not stay theirs for a year.
 *
 * The lifetime cannot be passed as `cookieOptions.maxAge`: @supabase/ssr
 * 0.12 overwrites any maxAge it is given with its own 400 days on every write
 * (applyServerStorage and the browser storage in its cookies.js), and only
 * keeps a zero for a deletion. So each `setAll` passes what it is handed
 * through `withSessionLifetime`.
 *
 * No imports, so the unit tests can load it, and ./proxy.ts with it, directly.
 */

export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** What every session cookie is written with; `secure` as the caller decides it. */
export function sessionCookieOptions(secure: boolean) {
  return { path: "/", sameSite: "lax" as const, httpOnly: false, secure };
}

/** The server's: Secure in production, which is served only over https. */
export function serverSessionCookieOptions() {
  return sessionCookieOptions(process.env.VERCEL_ENV === "production");
}

/**
 * A cookie's options with the lifetime capped at SESSION_COOKIE_MAX_AGE. A
 * deletion (maxAge 0) and a cookie with no maxAge are left as they are.
 */
export function withSessionLifetime<T extends { maxAge?: number } | undefined>(options: T): T {
  if (!options || typeof options.maxAge !== "number" || options.maxAge <= 0) return options;
  return { ...options, maxAge: Math.min(options.maxAge, SESSION_COOKIE_MAX_AGE) };
}
