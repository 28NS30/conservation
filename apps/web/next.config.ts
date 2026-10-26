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
   * `revalidate`: `s-maxage=300, stale-while-revalidate=300`). A page whose
   * `revalidate` came to more than this would lose its
   * stale-while-revalidate, so nothing cached, a page or a read it is made
   * from, may last longer than five minutes, which keeps the header's two
   * halves (test/public-pages-cache.test.mjs).
   *
   * Where it holds: in Next's own cache, which `next start` serves from;
   * and on Vercel for the pages built with the site, whose build output
   * carries both lifetimes (300 and 600, from the prerender manifest's
   * initialRevalidateSeconds and initialExpireSeconds). Not behind a CDN
   * put in front of `next start`: a page Next serves stale carries the
   * whole `s-maxage=300, stale-while-revalidate=300` again and no Age, so
   * such a CDN would start the page's ten minutes afresh when it is already
   * up to ten minutes old. And not, as far as this repository can show, for
   * a page rendered on its first visit on Vercel, as all but fifty species
   * pages are: their build output says expiration 1 and nothing about
   * staleness, and what the platform then does with the header is in code
   * that does not ship. So the species pages hold no point of a record at
   * all; their list is read per request (components/species/SpeciesRecords).
   * docs/launch-checklist.md has the check to make after a deploy.
   *
   * What it bounds is a change no writer announces. The app's own writers
   * drop every page that shows records when one changes, and again five
   * seconds on (reportsChanged() in lib/siteFigures.ts): normally at once,
   * at worst this bound. A blur tightened in the
   * database, by a migration, a floor or a TaiCOL refresh, runs none of
   * them. Anything that places a record more precisely than its blur may do
   * so for a few minutes at most, and an hour here left a quiet species page
   * listing the record's old point for sixty-five. The reads that place a
   * record are made afresh on every rebuild, so a point is gone within
   * these ten minutes; a count, read through the five-minute cache, within
   * fifteen. That assumes the rebuild does not throw; lib/siteFigures.ts
   * says what happens when it does, and why the reads that place records
   * do not.
   *
   * It costs no extra renders: a page is rebuilt at most once in five
   * minutes, and only when somebody asks for it, whatever this is. What it
   * changes is who waits. A page nobody has asked for in ten minutes is
   * rendered while its next visitor waits, where an hour served it old once
   * more and rebuilt it behind them; at this site's traffic that is most
   * visits to a page.
   *
   * When ten minutes is too long, deploy. A production deploy starts the
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
   *
   * And the sitemap index at the address robots.txt and every crawler
   * already knows. It is app/sitemap-index.xml/route.ts, which cannot sit at
   * /sitemap.xml itself while app/sitemap.ts exists; see that file.
   * `beforeFiles`, so both are decided before the pages and metadata routes.
   */
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/:locale(zh-TW|en)/species/:id(\\d+)", destination: "/:locale/species/by-id/:id" },
        { source: "/species/:id(\\d+)", destination: "/zh-TW/species/by-id/:id" },
        { source: "/sitemap.xml", destination: "/sitemap-index.xml" },
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
