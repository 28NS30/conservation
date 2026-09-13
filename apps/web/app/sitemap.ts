import type { MetadataRoute } from "next";
import { asPublic } from "@/lib/db";
import { speciesSlug } from "@/lib/species";
import { routing } from "@/i18n/routing";

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
         where s.taxon_id is not null
            or t.protected_status is not null
            or t.is_invasive
         limit 5000`,
    );
  } catch (e) {
    console.error(
      "[build] sitemap species entries skipped — database unreachable:",
      (e as Error).message,
    );
  }

  const staticPaths = [
    "",
    "/species",
    "/report",
    "/map",
    "/reports",
    "/season",
  ];
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
    for (const p of staticPaths) {
      entries.push({
        url: `${BASE}${prefix}${p || "/"}`,
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
