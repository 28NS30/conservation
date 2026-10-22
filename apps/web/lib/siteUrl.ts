/**
 * The site's address, written out once. Everything that must state an absolute
 * URL, and the old host's move to here (proxy.ts), reads it from this file.
 */
export const CANONICAL_ORIGIN = "https://formosawatch.biowatchitnl.org";

/**
 * The site's own canonical origin, for the files that must state it absolutely:
 * robots.txt, sitemap.xml, and every page's canonical and language links.
 *
 * NEXT_PUBLIC_SITE_URL was once never set in production, and the fallback was
 * "http://localhost:3000". The result was live and silent: production served
 *
 *     Sitemap: http://localhost:3000/sitemap.xml
 *
 * and a sitemap whose every <loc> was a localhost URL. A crawler cannot follow
 * any of it, so the entire sitemap — including the thousand-odd species pages it
 * exists to advertise — counted for nothing. Nothing failed, no page 500'd, and
 * no test could see it, because in every environment a test runs in, localhost
 * is the right answer.
 *
 * The fallback on Vercel was then VERCEL_PROJECT_PRODUCTION_URL, the project's
 * own production hostname. That stopped being safe when the site moved to its
 * own domain: Vercel fills it with the project's shortest production domain,
 * which can now be the bare apex, and the apex only redirects here. A
 * canonical link must name the page itself, not a redirect to it, so the
 * fallback is the address written out. Any Vercel build gets it, a preview
 * included, whose canonical should name production rather than itself.
 *
 * `||`, not `??`: .env.example sets the variable to the empty string, and
 * `new URL("")` throws in the layout.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL ? CANONICAL_ORIGIN : "http://localhost:3000");
