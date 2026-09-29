import type { MetadataRoute } from "next";
import { asPublic } from "@/lib/db";
import { speciesSlug } from "@/lib/species";
import { routing } from "@/i18n/routing";
import { seasonOpen } from "@/lib/coverage";

import { SITE_URL as BASE } from "@/lib/siteUrl";

/**
 * Static pages plus the species that are actually worth indexing.
 *
 * Deliberately not all 66,201 taxa: ~65,850 have no records and would be thin
 * pages. Included instead are every species with a report, plus protected and
 * invasive species, which are the ones people search for.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // A sitemap missing its species entries is a worse sitemap; a build that dies
  // because the database blinked is a worse deploy. See generateStaticParams in
  // species/[id] for the same trade-off.
  let species: { id: number; scientific_name: string; updated: Date | null }[] =
    [];
  try {
    species = await asPublic(
      (tx) => tx<
        { id: number; scientific_name: string; updated: Date | null }[]
      >`
        select t.id, t.scientific_name, greatest(t.updated_at, s.last_seen) as updated
          from taxa t
          left join species_report_stats s on s.taxon_id = t.id
         -- Species and subspecies only: a family or genus row can be protected
         -- or invasive as a group (99 of them), and its page is nearly empty.
         where t.rank in ('Species', 'Subspecies')
           and (s.taxon_id is not null
                or t.protected_status is not null
                or t.is_invasive)
         limit 5000`,
    );
  } catch (e) {
    console.error(
      "[build] sitemap species entries skipped — database unreachable:",
      (e as Error).message,
    );
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
   */
  const staticPaths = [
    "",
    "/species",
    "/map",
    "/stats",
    "/reports",
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
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
    for (const p of staticPaths) {
      entries.push({
        // "/en", not "/en/": the trailing slash answers with a redirect, and a
        // sitemap should list the address that answers.
        url: p ? `${BASE}${prefix}${p}` : `${BASE}${prefix || "/"}`,
        changeFrequency: "daily",
        priority: p ? 0.7 : 1,
      });
    }
    for (const s of species) {
      entries.push({
        url: `${BASE}${prefix}/species/${speciesSlug({ id: s.id, scientificName: s.scientific_name })}`,
        lastModified: s.updated ?? undefined,
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  }
  return entries;
}
