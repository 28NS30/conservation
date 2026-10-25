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
    // Pages each build worker renders at once; Next's default is 8. A worker
    // has two database connections while building (lib/db.ts), and pages
    // beyond what those can serve only wait on them, each with its own
    // 60-second prerender timeout running.
    staticGenerationMaxConcurrency: 4,
  },
  /**
   * How old a cached page may be when it is served, at most: ten minutes,
   * where Next's default is a year.
   *
   * A page past its `revalidate`, five minutes, is still served while a
   * fresh one is made, but only until ten minutes from when it was made;
   * after that its next visitor waits for a fresh render. It is also the
   * response's `stale-while-revalidate` (ten minutes less the page's
   * `revalidate`: `s-maxage=300, stale-while-revalidate=300`), so a CDN keeps
   * it no longer either. A page whose `revalidate` came to more than this
   * would lose its stale-while-revalidate and be kept by the CDN for the
   * whole of it. So nothing cached, a page or a read it is made from, may
   * last longer than five minutes, which keeps the header's two halves and
   * the fifteen minutes below (test/public-pages-cache.test.mjs).
   *
   * What it bounds is a change no writer announces. The app's own writers
   * drop every page that shows records the moment one changes
   * (reportsChanged() in lib/siteFigures.ts). A blur tightened in the
   * database, by a migration, a floor or a TaiCOL refresh, runs none of
   * them. Anything that places a record more precisely than its blur may do
   * so for a few minutes at most, and an hour here left a quiet species page
   * listing the record's old point for sixty-five. Now it is gone within
   * fifteen: these ten, plus the five the cached reads the page was rebuilt
   * from may already have been old. That assumes the rebuild's reads
   * succeed; lib/siteFigures.ts says what happens when they do not.
   *
   * It costs no extra renders: a page is rebuilt at most once in five
   * minutes, and only when somebody asks for it, whatever this is. What it
   * changes is who waits. A page nobody has asked for in ten minutes is
   * rendered while its next visitor waits, where an hour served it old once
   * more and rebuilt it behind them; at this site's traffic that is most
   * visits to a page.
   *
   * When fifteen minutes is too long, deploy. A production deploy starts the
   * page cache afresh, as it does the tiles', and it is the procedure after a
   * re-blur run by hand or by migration (docs/launch-checklist.md, "After a
   * change to a blur made in the database").
   */
  expireTime: 600,
  // The shared package ships TypeScript source rather than a build artifact.
  transpilePackages: ["@conservation/shared"],
  /**
   * A bare species id, `/species/32116`, goes to a page that redirects it to
   * the slug per request (app/[locale]/(site)/species/by-id), rather than to
   * the cached species page, which would answer its first visitor with the
   * Location header twice. Both spellings of the path, because which one a
   * rewrite here sees, the address as asked or as the proxy rewrote it for
   * the default locale, is Next's business.
   */
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/:locale(zh-TW|en)/species/:id(\\d+)", destination: "/:locale/species/by-id/:id" },
        { source: "/species/:id(\\d+)", destination: "/zh-TW/species/by-id/:id" },
      ],
    };
  },
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
