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
 * default, not this repo's doing — so these were what was actually missing. The
 * Content-Security-Policy, which came later and in two halves, is explained
 * where it is built, below this list.
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

/**
 * The Content-Security-Policy, in two halves: one the browser enforces, and one
 * it only reports on.
 *
 * ENFORCED: directives whose other side nothing on the site needs, so they can
 * hold from the first day without anything measured first.
 *
 *   - `frame-ancestors 'none'`: no page may be framed. X-Frame-Options' rule,
 *     in the form current browsers read first.
 *   - `base-uri 'self'`: an injected <base> cannot point the page's relative
 *     script and form addresses at another host.
 *   - `object-src 'none'`: no plugins. The site embeds nothing.
 *   - `form-action 'self'`: every form here posts to the site itself (Server
 *     Actions, the search forms, sign-out), so an injected form cannot post
 *     what someone types to anyone else. Google sign-in is a navigation
 *     supabase-js starts from a button, not a form, and is not governed by it.
 *   - `upgrade-insecure-requests`: a stray http:// address loads over https.
 *     Only on Vercel, where every response is https. Anywhere else the page
 *     itself is plain http, there is nothing to protect, and a browser that
 *     does not count localhost as secure would upgrade the local server's own
 *     requests to an https port nothing answers on. The same test the
 *     analytics in app/[locale]/layout.tsx uses.
 *
 * REPORT-ONLY: where scripts, styles, images, connections, workers and frames
 * may come from, listed from what the pages load. Measured on 26 October 2026
 * with this half enforced: the browser specs (pages, map, offline, receipt,
 * account) and a sign-in through the code form passed with nothing refused,
 * and the Turnstile widget, on Cloudflare's test key, rendered and solved.
 *
 *   - script-src: the site's own files, MapLibre's modules in public/maplibre
 *     among them; Turnstile's script; and 'unsafe-inline', because Next writes
 *     each page's React payload into the HTML as inline `self.__next_f.push`
 *     scripts. The Next docs offer a nonce instead
 *     (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md),
 *     and a nonce needs every page rendered per request, where nearly all of
 *     this site's pages are prerendered and served from the CDN. A hash cannot
 *     work either: the payload is different on every page. So this stops a
 *     script loaded from another host, and not one written inline. 'unsafe-eval'
 *     only under `next dev`, where React uses eval for its error overlay. In
 *     production nothing evaluates a string: zod tried once per schema until
 *     packages/shared turned that off (`z.config({ jitless: true })`).
 *   - style-src 'unsafe-inline': React writes `style` attributes into the HTML.
 *   - img-src data: and blob:, for MapLibre's control icons (data: SVGs in its
 *     stylesheet) and a photo previewed before it is sent; and Supabase, whose
 *     signed Storage URLs the record pages show photos from.
 *   - connect-src: OpenFreeMap for the basemap's style, tiles, glyphs and
 *     sprite, all on one host; MapTiler only when a key is set (lib/map.ts);
 *     Supabase for sign-in and photo uploads. A worker's own requests are held
 *     to this too, which matters for /sw.js: it caches OpenFreeMap's tiles.
 *   - worker-src 'self' blob:: MapLibre's worker is its module in
 *     public/maplibre, and blob: is what it builds when the worker's address is
 *     on another origin; the service worker is /sw.js.
 *   - frame-src: Turnstile's challenge, an iframe from challenges.cloudflare.com.
 *
 * Report-only, and with no report-uri, so a violation blocks nothing and goes
 * nowhere but the browser's console. That was the reason given in September for
 * not sending one: a console nobody reads. It is read now. Chromium writes each
 * report-only violation to the page's console (as information, not an error),
 * and e2e/pages.spec.mjs and e2e/map.spec.mjs fail on one, so CI's browser is
 * the collector, for every page in both languages and for the map. What it
 * cannot see is a worker's own violation, which stays in the worker's console;
 * for those the measurement above is the evidence: enforced, a tile blocked in
 * MapLibre's worker leaves a map with nothing drawn, and map.spec fails that.
 * Moving this half to the enforced header is a later change, made once CI has
 * stayed clean and the Turnstile widget has been watched under it in
 * production: CI has no site key, so the widget never renders there.
 *
 * Read when the config is loaded, which on Vercel is the build, where
 * NEXT_PUBLIC_SUPABASE_URL is set; a preview, which has no Supabase, names none.
 */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const OPENFREEMAP_ORIGIN = "https://tiles.openfreemap.org";
const MAPTILER_ORIGIN = "https://api.maptiler.com";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function contentSecurityPolicy(env: NodeJS.ProcessEnv = process.env) {
  const dev = env.NODE_ENV === "development";
  const supabase = originOf(env.NEXT_PUBLIC_SUPABASE_URL);
  const sources = (...list: (string | null | false | undefined)[]) =>
    list.filter(Boolean).join(" ");

  const enforced = [
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    env.VERCEL && "upgrade-insecure-requests",
  ];
  const reportOnly = [
    "default-src 'self'",
    `script-src ${sources("'self'", "'unsafe-inline'", dev && "'unsafe-eval'", TURNSTILE_ORIGIN)}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${sources("'self'", "data:", "blob:", supabase)}`,
    "font-src 'self'",
    `connect-src ${sources(
      "'self'",
      OPENFREEMAP_ORIGIN,
      env.NEXT_PUBLIC_MAPTILER_KEY && MAPTILER_ORIGIN,
      supabase,
    )}`,
    "worker-src 'self' blob:",
    `frame-src ${TURNSTILE_ORIGIN}`,
  ];
  return {
    enforced: enforced.filter(Boolean).join("; "),
    reportOnly: reportOnly.join("; "),
  };
}

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
    const csp = contentSecurityPolicy();
    return [
      {
        source: "/:path*{/}?",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
          { key: "Content-Security-Policy", value: csp.enforced },
          { key: "Content-Security-Policy-Report-Only", value: csp.reportOnly },
        ],
      },
    ];
  },
  // No `X-Powered-By: Next.js`. It tells a scanner which framework's
  // advisories to try first, and nobody else reads it.
  poweredByHeader: false,
};

export default withNextIntl(config);
