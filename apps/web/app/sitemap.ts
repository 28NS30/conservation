import type { MetadataRoute } from "next";
import { speciesSlug } from "@/lib/species";
import { routing } from "@/i18n/routing";
import { seasonOpen } from "@/lib/coverage";
import {
  parseSitemapId,
  recordChunk,
  sitemapIds,
  speciesChunk,
} from "@/lib/sitemaps";

import { SITE_URL as BASE } from "@/lib/siteUrl";

/**
 * Every five minutes at most, and only when a crawler asks. A species becomes
 * worth indexing when its first record arrives, and a report filed here when
 * it is published; built once per deploy, as this was, neither reached a
 * crawler until somebody happened to ship something. Not daily: nothing
 * cached here lasts past the site's bound (next.config.ts expireTime), so a
 * withdrawn record leaves the sitemap as it leaves the pages. The counts the
 * files are cut by are a cached figure (lib/sitemaps.ts).
 */
export const revalidate = 300;

/**
 * One sitemap per language and kind of page, listed by the index at
 * /sitemap.xml (app/sitemap-index.xml/route.ts). lib/sitemaps.ts says why they are
 * split and how.
 */
export async function generateSitemaps() {
  return (await sitemapIds()).map((id) => ({ id }));
}

/**
 * The pages worth pointing a crawler at.
 *
 * This list was precisely inverted relative to what the site is becoming: it
 * offered `/report` — the page whose job moves to the app — and omitted every
 * page that explains the project. `/stats`, `/about`, `/privacy` and
 * `/attribution` were unreachable from the sitemap despite being the surfaces
 * a cold reader actually needs, and `/attribution` is where the data's
 * provenance is credited, which is the one page a data publisher is expected
 * to have indexed.
 *
 * `/report` stays, with the three report pages it leads to. The team
 * settled that the web form stays (see `docs/app-and-site.md`), and asked
 * for it as three pages, so each is a page a search can land someone on.
 *
 * Not here on purpose: `/team`, which 404s by design while the roster is
 * empty, `/me` and `/admin`, which need an account, and `/lab`, which is
 * gated. A sitemap that lists a 404 is worse than a short sitemap.
 *
 * The three collection pages are here because each is where its database is
 * explained and counted — and /invasive carries the list of invasive
 * animals, which is the page a searcher for one is most likely to want.
 */
async function pagePaths(): Promise<string[]> {
  const staticPaths = [
    "",
    "/species",
    "/map",
    "/stats",
    "/reports",
    "/roadkill",
    "/invasive",
    "/wildlife",
    "/report",
    "/report/roadkill",
    "/report/invasive",
    "/report/wildlife",
    "/about",
    "/attribution",
    "/privacy",
    "/terms",
  ];
  // The season goal only once somebody has filed a report; see seasonOpen().
  if (await seasonOpen()) staticPaths.push("/season");
  return staticPaths;
}

/**
 * Static pages, the reports filed here, and the species actually worth
 * indexing — never all 136,680 taxa, most of which would be thin pages. Which
 * species is INDEXWORTHY (lib/indexworthy.ts), the rule the species page
 * itself applies, so nothing listed here answers with noindex.
 */
export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const part = parseSitemapId(await props.id);
  if (!part) return [];
  const prefix = part.locale === routing.defaultLocale ? "" : `/${part.locale}`;

  if (part.kind === "pages") {
    return (await pagePaths()).map((p) => ({
      // "/en", not "/en/": the trailing slash answers with a redirect, and a
      // sitemap should list the address that answers.
      url: p ? `${BASE}${prefix}${p}` : `${BASE}${prefix || "/"}`,
      changeFrequency: "daily",
      priority: p ? 0.7 : 1,
    }));
  }

  // A file missing its entries is a worse sitemap; a build that dies because
  // the database blinked is a worse deploy. See generateStaticParams in
  // species/[id] for the same trade-off. Only at build, though: after it, a
  // failure is thrown, so the revalidation fails and the file already served
  // stays, rather than an empty one replacing it for a day.
  try {
    if (part.kind === "records") {
      return (await recordChunk(part.chunk)).map((r) => ({
        url: `${BASE}${prefix}/reports/${r.id}`,
        lastModified: r.created ?? undefined,
        changeFrequency: "weekly",
        priority: 0.5,
      }));
    }
    return (await speciesChunk(part.chunk)).map((s) => ({
      url: `${BASE}${prefix}/species/${speciesSlug(s)}`,
      lastModified: s.updated ?? undefined,
      changeFrequency: "weekly",
      priority: 0.5,
    }));
  } catch (e) {
    if (process.env.NEXT_PHASE !== "phase-production-build") throw e;
    console.error(
      `[build] sitemap ${part.kind} entries skipped — database unreachable:`,
      (e as Error).message,
    );
    return [];
  }
}
