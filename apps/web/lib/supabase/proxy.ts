import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

/**
 * The auth cookie's name for this project: supabase-js names it
 * `sb-<first label of the API host>-auth-token`, and splits a long session
 * into `.0`, `.1`… chunks under the same name.
 */
export function authCookieName(supabaseUrl: string): string | null {
  try {
    return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

/** Whether the request carries a session at all (the PKCE verifier alone does not count). */
export function hasSessionCookie(
  names: Iterable<string>,
  cookieName: string,
): boolean {
  for (const name of names)
    if (name === cookieName || name.startsWith(`${cookieName}.`)) return true;
  return false;
}

export type Refreshed = {
  cookies: { name: string; value: string; options: CookieOptions }[];
  headers: Record<string, string>;
};

/**
 * Renew an expiring session before the page renders, so the page sees the new
 * one and the browser is sent it.
 *
 * Why this has to be here: Supabase access tokens last an hour, and the only
 * code that can renew one on the server and keep the result is code that can
 * set cookies. Server Components cannot. So without this, the header's
 * `getUser()` found an expired token, spent the single-use refresh token to get
 * a new one, and then had nowhere to put it — the next request arrived with the
 * old, now-spent refresh token and the person was signed out, about an hour
 * after signing in, with nothing logged. lib/supabase/server.ts said a
 * middleware did this; none did.
 *
 * Two halves, both required:
 *   - the new cookies go onto the REQUEST, so this render's Server Components
 *     read the renewed session rather than trying to renew it a second time;
 *   - and onto the RESPONSE (applied by the caller), so the browser keeps it.
 *
 * `getSession()` rather than `getClaims()` or `getUser()`: this only renews.
 * It trusts nothing it reads and decides nothing — who someone is, and whether
 * they may do a thing, is settled by `getUser()` where the data is served
 * (lib/supabase/server.ts, lib/auth.ts). `getSession()` touches the network
 * only when the token is actually near expiry; the others would add a round
 * trip to Supabase to every signed-in request, prefetches included.
 *
 * Returns what the response must carry, or null when nothing changed. Never
 * throws: a Supabase that is down or slow must not take the site with it.
 *
 * And never waits long. supabase-js retries a refresh that gets no answer, with
 * backoff, for up to 30 seconds; in the proxy that would hold every page a
 * signed-in person opens for half a minute during an outage. So the attempt has
 * a deadline, after which the page renders with the session it came with — as
 * it would have before this existed.
 */
export async function refreshSession(
  request: NextRequest,
  { deadlineMs = 5000 }: { deadlineMs?: number } = {},
): Promise<Refreshed | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Previews have no Supabase, so nobody can be signed in on one.
  if (!url || !key) return null;

  const cookieName = authCookieName(url);
  if (!cookieName) return null;
  // The cheap exit, and nearly every request takes it: no session cookie, no
  // session, nothing to renew. No client is built and nothing is fetched.
  if (!hasSessionCookie(request.cookies.getAll().map((c) => c.name), cookieName))
    return null;

  const deadline = AbortSignal.timeout(deadlineMs);
  let out: Refreshed | null = null;
  let late = false;
  try {
    const supabase = createServerClient(url, key, {
      global: {
        // A request still open at the deadline is aborted. One asked for after
        // it is answered here with a 408 and never sent: supabase-js retries
        // anything that throws, so only a real HTTP refusal ends its backoff
        // loop rather than leaving it to spin on for the rest of its 30 seconds.
        fetch: async (input, init) => {
          if (deadline.aborted)
            return Response.json(
              { code: 408, error_code: "request_timeout", msg: "Session refresh abandoned at the proxy's deadline" },
              { status: 408 },
            );
          return fetch(input, {
            ...init,
            signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
          });
        },
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, headers) => {
          // Past the deadline the response has already gone.
          if (late) return;
          for (const { name, value, options } of list) {
            // RequestCookies rewrites the Cookie header as it goes, and
            // next-intl forwards that header to the render.
            if (!value || options?.maxAge === 0) request.cookies.delete(name);
            else request.cookies.set(name, value);
          }
          out = {
            cookies: list.map((c) => ({ ...c, options: { ...c.options } })),
            headers: { ...headers },
          };
        },
      },
    });
    const timedOut = new Promise<"late">((resolve) =>
      deadline.addEventListener("abort", () => resolve("late"), { once: true }),
    );
    if ((await Promise.race([supabase.auth.getSession(), timedOut])) === "late") {
      late = true;
      return null;
    }
  } catch {
    return null;
  }
  return out;
}

/** Put what `refreshSession` produced onto whatever response routing chose. */
export function applyRefreshed(response: NextResponse, refreshed: Refreshed | null) {
  if (!refreshed) return response;
  for (const { name, value, options } of refreshed.cookies)
    response.cookies.set(name, value, options);
  // Supabase asks for these whenever it sets auth cookies: a response carrying
  // one person's session must never be cached and served to someone else.
  for (const [k, v] of Object.entries(refreshed.headers)) response.headers.set(k, v);
  return response;
}
