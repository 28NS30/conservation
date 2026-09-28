import type { MetadataRoute } from "next";

import { SITE_URL as BASE } from "@/lib/siteUrl";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Nothing here is secret, but none of it is worth indexing and /admin is
      // role-gated anyway. Both locales: English lives under /en, and listing
      // only the unprefixed paths left /en/admin and /en/login open to crawl.
      disallow: [
        "/admin", "/en/admin",
        "/login", "/en/login",
        "/me", "/en/me",
        "/api/", "/auth/",
      ],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
