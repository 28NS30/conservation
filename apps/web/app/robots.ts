import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

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
