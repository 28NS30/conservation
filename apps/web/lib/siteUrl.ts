/**
 * The site's own canonical origin, for the files that must state it absolutely:
 * robots.txt and sitemap.xml.
 *
 * NEXT_PUBLIC_SITE_URL has never been set in production, and the fallback was
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
 * Vercel sets VERCEL_PROJECT_PRODUCTION_URL at build time to the project's own
 * production hostname, which is correct even in a preview build — a preview's
 * canonical URL should point at production, not at itself. So the fallback now
 * lands on something real, and setting NEXT_PUBLIC_SITE_URL is what a custom
 * domain needs rather than what a working sitemap needs.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");
