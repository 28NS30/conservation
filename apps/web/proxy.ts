import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { applyRefreshed, refreshSession } from "./lib/supabase/proxy";
import { CANONICAL_ORIGIN } from "./lib/siteUrl";

const handleI18nRouting = createMiddleware(routing);

/** Where the site lived before it moved to CANONICAL_ORIGIN. */
const OLD_HOST = "preservation-web-one.vercel.app";

/**
 * Sent by the service worker on the old host, and only while a report saved on
 * that phone is still waiting to be sent. See movedFromOldHost.
 */
const UNSENT_REPORTS_HEADER = "x-unsent-reports";

/**
 * A page asked for on the old host, answered with a 308 to the same path and
 * query on the new one. Search engines move the page's standing with a
 * permanent redirect, and a shared link keeps working.
 *
 * Page navigations only. Everything the matcher below leaves out (the API,
 * /auth, Next's own files, sw.js, the manifest, any file with an extension and
 * the share cards) still answers on the old host, because a phone may hold
 * reports saved there while it had no signal: they live in that origin's
 * IndexedDB, which the new host cannot read, and they can only be sent from the
 * old origin, to its own /api. For the same reason three kinds of request are
 * passed through:
 *
 *   - Anything but GET and HEAD. A server action posts to the page's own path,
 *     and a 308 would carry the post to another origin, where it fails.
 *   - A fetch made by a page on the old host itself, such as Next's RSC
 *     fetches and prefetches from a tab already open there. Moved, each would
 *     fail as a cross-origin fetch before Next fell back to loading the page
 *     whole. Passed through, the open tab keeps working, and its next full
 *     page load moves. Told apart by the browser's Sec-Fetch headers, because
 *     Next strips its own RSC headers and `_rsc` before the proxy sees the
 *     request. Both are required: a crawler sends neither, and Node's fetch
 *     sends Sec-Fetch-Mode without Sec-Fetch-Site, and each of those is moved.
 *   - A navigation carrying UNSENT_REPORTS_HEADER. A queued report is only ever
 *     sent from a page open on its own origin (lib/offline/flush.ts), so a
 *     blanket move would strand it on the phone for good. The old host's
 *     service worker adds the header while any are unsent (public/sw.js); the
 *     page loads there as it always did, the queue goes to the old host's /api,
 *     and the next navigation after it is empty moves.
 */
function movedFromOldHost(request: NextRequest): NextResponse | null {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (host !== OLD_HOST) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const mode = request.headers.get("sec-fetch-mode");
  if (request.headers.get("sec-fetch-site") === "same-origin" && mode && mode !== "navigate") return null;
  if (request.headers.get(UNSENT_REPORTS_HEADER) === "1") return null;
  const { basePath, pathname, search } = request.nextUrl;
  return NextResponse.redirect(`${CANONICAL_ORIGIN}${basePath}${pathname}${search}`, 308);
}

/**
 * Three jobs, in this order: move a page off the old host, renew the Supabase
 * session if it is about to lapse, then route by locale.
 *
 * The move comes first because it answers without either of the others: the
 * page is rendered on the new host, which renews and routes for itself.
 *
 * The order of the other two matters. The renewal writes the new session into
 * the request's cookies; next-intl then forwards the request's headers —
 * cookies included — to the page it rewrites or passes the request on to, so
 * the page renders with the renewed session. Routing first would hand the page
 * the stale one.
 *
 * Whatever routing decides (pass through, rewrite to /zh-TW/…, redirect to drop
 * a /zh-TW prefix), the renewed cookies ride on that response. A redirect
 * carrying Set-Cookie is fine: the browser stores them before following it.
 *
 * Most requests pay nothing for the renewal: without a session cookie it
 * returns before building a client (see lib/supabase/proxy.ts).
 */
export async function proxy(request: NextRequest) {
  const moved = movedFromOldHost(request);
  if (moved) return moved;
  const refreshed = await refreshSession(request);
  return applyRefreshed(handleI18nRouting(request), refreshed);
}
export default proxy;

export const config = {
  /**
   * Everything except API routes, Next internals, the vendored MapLibre bundle,
   * share cards, and files with an extension.
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
   * Share cards (`opengraph-image`, the site's and each species') are excluded
   * because Next names them with the locale in the path, /zh-TW/opengraph-image,
   * and the locale routing answered every Chinese one with a 307 to drop the
   * prefix. A link preview fetched by LINE or Facebook should be the image, not
   * a redirect some of them never follow. The path already carries the locale,
   * so nothing is lost by skipping the routing.
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
  matcher: ["/", "/((?!api|auth/|_next|maplibre|.*opengraph-image|.*\\..*).*)"],
};
