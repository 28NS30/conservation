import type { MetadataRoute } from "next";

import { SITE_URL as BASE } from "@/lib/siteUrl";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Nothing here is secret, but none of it is worth indexing and /admin is
      // role-gated anyway.
      disallow: ["/admin", "/api/", "/login", "/auth/"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
