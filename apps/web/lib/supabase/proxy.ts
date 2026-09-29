import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

/*
 * Giving up on Supabase Auth in time.
 *
 * supabase-js has no timeout of its own. A refresh that gets no answer, or an
 * answer it counts as a network fault (a thrown fetch, any 5xx), is retried
 * with backoff for up to 30 seconds; any other request simply waits for as long
 * as the socket does. The proxy renews sessions and the header asks who is
 * signed in on every page, so during a Supabase outage both would hold every
 * page a signed-in person opens for that long. `fetchUntil` and `settledBy`
 * let each of them stop at a deadline and carry on as if nobody were signed
 * in, which is what the outage means anyway.
 *
 * They live here rather than in a module of their own because the unit tests
 * import this file directly under Node, which cannot follow an extensionless
 * relative import; lib/supabase/server.ts imports them from here.
 */

/**
 * A fetch for supabase-js that stops at `deadline`.
 *
 * Aborting the request in flight is not enough by itself: supabase-js reads
 * the abort as a network fault and retries, and would spin through its backoff
 * for the rest of the 30 seconds in the background. So once the deadline has
 * passed, the next request is not sent; it is answered here with a 408, which
 * supabase-js takes as a real refusal and stops on. A refusal also makes it
 * clear the session it was renewing, so a client given this fetch must ignore
 * cookie writes once the deadline has passed (both callers do), or a slow
 * Supabase would sign people out.
 *
 * The cost, accepted knowingly: if Supabase did renew the session but answered
 * after the deadline, the new refresh token is lost with the aborted response.
 * The browser still holds the old one, which Supabase honours for its reuse
 * interval (10 s by default) and treats as theft after it, ending that session.
 * That takes an answer slower than the deadline followed by a pause of over
 * ten seconds — a Supabase in real trouble — and the alternative is every page
 * waiting out that trouble.
 */
export function fetchUntil(deadline: AbortSignal): typeof fetch {
  return async (input, init) => {
    if (deadline.aborted)
      return Response.json(
        { code: 408, error_code: "request_timeout", msg: "Abandoned at the auth deadline" },
        { status: 408 },
      );
    return fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
    });
  };
}

/** What `settledBy` gives back when the deadline came first. */
export const LATE: unique symbol = Symbol("late");

/**
 * `work`, or LATE if `deadline` passes first.
 *
 * `fetchUntil` alone does not bound the wait: at the deadline supabase-js may
 * be asleep between retries, and only notices on waking. This returns at the
 * deadline whatever it is doing; the work finishes in the background, where
 * `fetchUntil` makes sure it finishes quickly.
 */
export function settledBy<T>(work: Promise<T>, deadline: AbortSignal): Promise<T | typeof LATE> {
  if (deadline.aborted) {
    work.catch(() => {});
    return Promise.resolve(LATE);
  }
  return new Promise((resolve, reject) => {
    const late = () => resolve(LATE);
    deadline.addEventListener("abort", late, { once: true });
    work.then(
      (value) => {
        deadline.removeEventListener("abort", late);
        resolve(value);
      },
      (error) => {
        deadline.removeEventListener("abort", late);
        reject(error);
      },
    );
  });
}

/**
 * Whether a Supabase access token was issued for a password sign-in.
 *
 * The site never asks for a password: sign-in is an emailed code or link. But
 * Supabase's email provider also answers POST /auth/v1/signup with a password
 * to anyone holding the public key, and there is no setting that turns that
 * half off. So someone could register another person's address with a
 * password of their own; when the owner of the address later signed in with a
 * code, Supabase confirmed the account and kept that password, and its setter
 * could sign in as them, as a moderator if the address was one (security
 * audit, 29 September 2026). A session whose token says it came from a
 * password is therefore not a session this site recognises.
 *
 * Reads the token without verifying it. It decides only to refuse, and the
 * callers read it after `getUser()` has had Supabase verify the same token.
 */
export function passwordSession(accessToken: string | null | undefined): boolean {
  const payload = accessToken?.split(".")[1];
  if (!payload) return false;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const amr = (JSON.parse(json) as { amr?: unknown }).amr;
    return (
      Array.isArray(amr) &&
      amr.some((a) => typeof a === "object" && a !== null && (a as { method?: unknown }).method === "password")
    );
  } catch {
    return false;
  }
}

/**
 * Where password sessions are refused: production. Local development and CI
 * sign throwaway accounts in with a password (e2e/account.spec.mjs,
 * test/stub-gotrue.mjs), and nothing there is anyone's.
 */
export function refusesPasswordSessions(): boolean {
  return process.env.VERCEL_ENV === "production";
}

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
 * throws: a Supabase that is down or slow must not take the proxy with it.
 *
 * And never waits long. supabase-js retries a refresh that gets no answer, with
 * backoff, for up to 30 seconds; in the proxy that would hold every page a
 * signed-in person opens for half a minute during an outage. So the attempt has
 * a deadline (`fetchUntil` above), after which the page renders with the
 * session it came with — as it would have before this existed. The page's own
 * question, who is signed in, has a deadline of its own (server.ts).
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
  try {
    const supabase = createServerClient(url, key, {
      global: { fetch: fetchUntil(deadline) },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, headers) => {
          // Past the deadline the response has already gone, and what is left
          // to write is supabase-js clearing the session it gave up on.
          if (deadline.aborted) return;
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
    const got = await settledBy(supabase.auth.getSession(), deadline);
    if (got === LATE) return null;
    // A password session is ended here, on the way in, so no page renders
    // with it and the browser is told to forget it (passwordSession, above).
    if (refusesPasswordSessions() && passwordSession(got.data.session?.access_token)) {
      if ((await settledBy(supabase.auth.signOut({ scope: "local" }), deadline)) === LATE) return null;
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
