import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Served from the root of its own subdomain. The prefix machinery is inert;
 * see lib/basePath.ts.
 *
 * Driven by an environment variable rather than hardcoded so the tests, the
 * local dev server and any standalone deploy keep working unchanged — every
 * e2e spec talks to localhost:3000/… and would otherwise need rewriting.
 *
 * `basePath` covers <Link>, router navigation, next/image and API route
 * mounting. It does NOT cover hand-written paths; see lib/basePath.ts.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

/**
 * Response headers, applied to every path.
 *
 * The site sent none of these. HSTS is already served — it is Vercel's platform
 * default, not this repo's doing — so these four are what was actually missing.
 * A Content-Security-Policy is deliberately NOT here; see the note at the end.
 *
 * `Permissions-Policy` is the one with teeth, and the one easiest to get wrong
 * in a way that breaks the product rather than the attack:
 *
 *   - **geolocation must stay allowed.** `LocationPicker` calls
 *     `navigator.geolocation.getCurrentPosition`, which IS governed by this
 *     header. `geolocation=()` would silently disable "use my location" — the
 *     fastest path through the report form, and the only one that gives an
 *     accurate coordinate rather than a dragged pin.
 *   - **camera is allowed as a precaution, not because it is required.** The
 *     report form uses `capture="environment"` on a file input, which opens the
 *     camera through the platform's picker rather than `getUserMedia`, and the
 *     spec does not clearly place that under this header. Denying it is
 *     therefore probably harmless — and "probably" is not good enough when the
 *     cost of being wrong is that nobody can photograph anything on a phone.
 *
 * Everything else is denied outright. Nothing in this app asks for a
 * microphone, a payment sheet, a USB device or a motion sensor, and a feature
 * nobody uses is a feature that should not be reachable from an injected
 * script.
 */
const PERMISSIONS_POLICY = [
  "geolocation=(self)",
  "camera=(self)",
  "microphone=()",
  "payment=()",
  "usb=()",
  "display-capture=()",
  "accelerometer=()",
  "gyroscope=()",
  "magnetometer=()",
  "midi=()",
  "serial=()",
  "bluetooth=()",
  "idle-detection=()",
  "screen-wake-lock=()",
  "xr-spatial-tracking=()",
].join(", ");

const config: NextConfig = {
  ...(basePath ? { basePath } : {}),
  experimental: {
    // Serves app/global-not-found.tsx for URLs matching no route. Required
    // because this app's root layout sits under a dynamic [locale] segment, so
    // there is no single layout Next can compose a global 404 from — the case
    // the docs name for this flag.
    globalNotFound: true,
  },
  // The shared package ships TypeScript source rather than a build artifact.
  transpilePackages: ["@conservation/shared"],
  /**
   * `/:path*{/}?` is every path, with or without a trailing slash.
   *
   * `X-Frame-Options: DENY` rather than SAMEORIGIN: nothing here is meant to be
   * embedded, by us or anyone. Note this governs whether OUR pages can be put in
   * a frame — it does not affect the Turnstile widget, which is an iframe we
   * place into our own page.
   *
   * `Referrer-Policy: strict-origin-when-cross-origin` is chosen for a specific
   * reason rather than as a default. A species path can itself be sensitive —
   * `/species/37689` names a protected snake — and this sends only the origin
   * cross-origin, so the path a reader was on never leaves with the request.
   */
  async headers() {
    return [
      {
        source: "/:path*{/}?",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
