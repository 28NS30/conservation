import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Completes the magic-link sign-in by exchanging the one-time code for a session
 * cookie, then redirects. `next` is constrained to a same-origin path so the link
 * cannot be used as an open redirect.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next") ?? "/";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  const supabase = await serverSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=exchange_failed", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
