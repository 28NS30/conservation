import { sitemapIds } from "@/lib/sitemaps";
import { SITE_URL as BASE } from "@/lib/siteUrl";

/**
 * The sitemap index, listing every sitemap app/sitemap.ts serves. It is
 * served at /sitemap.xml, the address robots.txt names, by a rewrite in
 * next.config.ts.
 *
 * Next writes no index of its own. Once app/sitemap.ts splits itself with
 * generateSitemaps, its files move to /sitemap/{id}.xml and nothing answers
 * at /sitemap.xml at all, which is the address robots.txt, Search Console and
 * every earlier crawl know. A route of our own cannot live at /sitemap.xml
 * beside app/sitemap.ts (Next refuses the build: "Conflicting route and
 * metadata"), so it lives here and the rewrite puts it there. It reads the
 * same list of ids the sitemaps are generated from, so the two cannot name
 * different files.
 *
 * Revalidated as the sitemaps are, every five minutes at most: a new file
 * appears when a kind of page outgrows the last one (lib/sitemaps.ts).
 */
export const revalidate = 300;

/** Ids are `[a-zA-Z0-9-]`, but a loc is XML and is written as XML. */
const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET() {
  const ids = await sitemapIds();
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...ids.map((id) => `<sitemap><loc>${xml(`${BASE}/sitemap/${id}.xml`)}</loc></sitemap>`),
    "</sitemapindex>",
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
