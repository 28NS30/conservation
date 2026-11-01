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
        // What put this site over Vercel's free allowance of server time on
        // 28 October 2026, down until the next usage cycle: crawlers walking
        // these. Each record page is rendered per request, there are 46,000 of
        // them in two languages, each is one row of a dataset already
        // published on GBIF, and the species pages already carry their
        // records. The query strings are filters and page numbers over the
        // same lists, whose combinations do not end. The first page of each
        // list, the species pages and the collections stay open.
        "/reports/", "/en/reports/",
        "/reports?", "/en/reports?",
        "/species?", "/en/species?",
        "/map?", "/en/map?",
      ],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
