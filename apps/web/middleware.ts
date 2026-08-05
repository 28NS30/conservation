import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  /**
   * Everything except API routes, Next internals, the vendored MapLibre bundle,
   * and files with an extension.
   *
   * `/api` must be excluded: tile and submission endpoints are locale-independent,
   * and prefixing them would break MapLibre's tile URLs and every fetch in the app.
   */
  matcher: ["/((?!api|_next|maplibre|.*\\..*).*)"],
};
