import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export const proxy = createMiddleware(routing);
export default proxy;

export const config = {
  /**
   * Everything except API routes, Next internals, the vendored MapLibre bundle,
   * and files with an extension.
   *
   * `/api` must be excluded: tile and submission endpoints are locale-independent,
   * and prefixing them would break MapLibre's tile URLs and every fetch in the app.
   *
   * `"/"` is listed separately and is load-bearing under a basePath. A request to
   * /ecowatch arrives here with its pathname normalised to the empty string, which
   * the pattern below — anchored on a leading slash — does not match. The proxy
   * then never ran for the site's own front page, so the default locale was never
   * rewritten in and /ecowatch alone 404'd while every route under it worked.
   */
  matcher: ["/", "/((?!api|_next|maplibre|.*\\..*).*)"],
};
