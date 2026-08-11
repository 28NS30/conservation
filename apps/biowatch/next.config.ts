import type { NextConfig } from "next";

/**
 * One domain, three apps.
 *
 * biowatchintl.org serves this app at the root and proxies the two project
 * apps at their own paths, so they appear as subpages of one site while staying
 * separate deployments that build, break and ship independently.
 *
 * Each child sets a matching base path of its own — Next's `basePath` for
 * EcoWatch, Vite's `base` plus a router basename for FireWatch. That is what
 * makes a single `/:path*` rewrite sufficient: with it, the child's own asset
 * URLs already carry the prefix, so scripts, styles and API calls all fall
 * under the same rule rather than needing one apiece.
 */
const ECOWATCH = process.env.ECOWATCH_ORIGIN ?? "https://ecowatch-internal.vercel.app";
const FIREWATCH = process.env.FIREWATCH_ORIGIN ?? "https://firewatch-internal.vercel.app";

const config: NextConfig = {
  async rewrites() {
    return [
      { source: "/ecowatch", destination: `${ECOWATCH}/ecowatch` },
      { source: "/ecowatch/:path*", destination: `${ECOWATCH}/ecowatch/:path*` },
      { source: "/firewatch", destination: `${FIREWATCH}/firewatch` },
      { source: "/firewatch/:path*", destination: `${FIREWATCH}/firewatch/:path*` },
    ];
  },
};

export default config;
