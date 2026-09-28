import { NextResponse, type NextRequest } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";
import {
  NEXT_COOKIE,
  NEXT_COOKIE_PATH,
  loginPathFor,
  nextFromCookie,
  safeNextPath,
} from "@/lib/signInNext";

/**
 * Where an email sign-in link and "Continue with Google" both land: exchanges
 * the one-time code for a session cookie, then sends the person back to the
 * page they were on.
 *
 * That page comes from `?next=` if present, otherwise from the short-lived
 * cookie the login page set before sending them away (lib/signInNext.ts says
 * why it is a cookie). Either way it passes `safeNextPath`, so this URL cannot
 * be used to bounce someone to another site under this one's name.
 *
 * A failure goes back to the sign-in form in the reader's language, still
 * carrying the return path, so a second attempt with the emailed code ends up
 * where the first was meant to.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next =
    safeNextPath(url.searchParams.get("next")) ??
    nextFromCookie(req.cookies.get(NEXT_COOKIE)?.value) ??
    "/";

  if (!code) return backToLogin(next, "missing_code");

  const supabase = await serverSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return backToLogin(next, "exchange_failed");

  const res = redirectTo(next);
  // Spent. Left behind it would steer the next, unrelated sign-in. (`delete`,
  // which writes an expiry in 1970: `maxAge: 0` did not survive to the header
  // here, and the browser kept the cookie with an empty value.)
  res.cookies.delete({ name: NEXT_COOKIE, path: NEXT_COOKIE_PATH });
  return res;
}

function backToLogin(next: string, error: string) {
  const query = new URLSearchParams({ error });
  if (next !== "/") query.set("next", next);
  return redirectTo(`${loginPathFor(next)}?${query}`);
}

/**
 * A redirect to a path on this site, with the Location left relative.
 *
 * It used to be made absolute from `req.url`, and `req.url` is not always the
 * address the person used: under `next start` it names the host the server
 * bound to. Signing in at 127.0.0.1 set the session cookie for 127.0.0.1 and
 * then sent the browser to localhost, where there was no session — signed in
 * and shown as signed out. Behind a proxy the same thing can happen with any
 * host. A relative Location is resolved by the browser against the URL it
 * actually requested, which is the one the cookies belong to.
 */
function redirectTo(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}
