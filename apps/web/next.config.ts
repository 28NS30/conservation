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

const config: NextConfig = {
  ...(basePath ? { basePath } : {}),
  // The shared package ships TypeScript source rather than a build artifact.
  transpilePackages: ["@conservation/shared"],
};

export default withNextIntl(config);
