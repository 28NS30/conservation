import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { applyRefreshed, refreshSession } from "./lib/supabase/proxy";

const handleI18nRouting = createMiddleware(routing);

/**
 * Two jobs, in this order: renew the Supabase session if it is about to lapse,
 * then route by locale.
 *
 * The order matters. The renewal writes the new session into the request's
 * cookies; next-intl then forwards the request's headers — cookies included —
 * to the page it rewrites or passes the request on to, so the page renders
 * with the renewed session. Routing first would hand the page the stale one.
 *
 * Whatever routing decides (pass through, rewrite to /zh-TW/…, redirect to drop
 * a /zh-TW prefix), the renewed cookies ride on that response. A redirect
 * carrying Set-Cookie is fine: the browser stores them before following it.
 *
 * Most requests pay nothing for the first job: without a session cookie it
 * returns before building a client (see lib/supabase/proxy.ts).
 */
export async function proxy(request: NextRequest) {
  const refreshed = await refreshSession(request);
  return applyRefreshed(handleI18nRouting(request), refreshed);
}
export default proxy;

export const config = {
  /**
   * Everything except API routes, Next internals, the vendored MapLibre bundle,
   * and files with an extension.
   *
   * `/api` must be excluded: tile and submission endpoints are locale-independent,
   * and prefixing them would break MapLibre's tile URLs and every fetch in the app.
   * They get no session renewal here, and need none: a Route Handler can set
   * cookies itself, so `serverSupabase()` renews and keeps a session there.
   *
   * `/auth` must be excluded for the same reason, and forgetting it broke sign-in
   * outright. The magic-link callback lives at app/auth/callback, outside
   * [locale], and Supabase sends people to exactly that URL. The proxy rewrote it
   * to the default locale's /zh-TW/auth/callback, which does not exist — so every
   * magic link in production landed on a 404 and nobody could sign in. Nothing
   * had exercised the callback, because nobody has signed in yet.
   *
   * Static files are excluded by the `.*\\..*` clause, so no image, script or
   * font request ever reaches the session check.
   *
   * `"/"` is listed separately and is load-bearing under a basePath. A request to
   * a prefixed root arrives here with its pathname normalised to the empty string,
   * which
   * the pattern below — anchored on a leading slash — does not match. The proxy
   * then never ran for the site's own front page, so the default locale was never
   * rewritten in and that one path 404'd while every route under it worked.
   */
  matcher: ["/", "/((?!api|auth/|_next|maplibre|.*\\..*).*)"],
};
