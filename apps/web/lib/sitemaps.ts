import "server-only";

import { asPublic } from "@/lib/db";
import { INDEXWORTHY } from "@/lib/indexworthy";
import { routing } from "@/i18n/routing";

/**
 * Which sitemaps the site has, and what is in the ones that come from the
 * database. app/sitemap.ts serves each of them and app/sitemap-index.xml/route.ts
 * lists them in the index that robots.txt names.
 *
 * WHY THERE ARE SEVERAL. The single sitemap stopped at `limit 5000` and was
 * one file for both languages, so it could only ever grow by dropping pages.
 * It is now one set per language, because each language's pages are pages of
 * their own (lib/alternates.ts), and each set is split by kind: the fixed
 * pages, the records people filed here, and the species. A kind that outgrows
 * one file continues in the next, PER_SITEMAP at a time, so no file reaches
 * the protocol's 50,000 URLs whatever the database grows to.
 *
 * Ordered by id, so a page stays in the same file from one day to the next
 * and a crawler's view of a file changes only where the data did.
 */
export const PER_SITEMAP = 40_000;

export type SitemapKind = "pages" | "records" | "species";

export type SitemapPart = { locale: string; kind: SitemapKind; chunk: number };

/** `zh-TW-pages`, `en-species-0`: the file's name, without `.xml`. */
export function sitemapId(p: SitemapPart): string {
  return p.kind === "pages" ? `${p.locale}-pages` : `${p.locale}-${p.kind}-${p.chunk}`;
}

export function parseSitemapId(id: string): SitemapPart | null {
  const m = /^(.+)-(pages|records|species)(?:-(\d+))?$/.exec(id);
  if (!m) return null;
  const [, locale, kind, n] = m;
  if (!(routing.locales as readonly string[]).includes(locale)) return null;
  if ((kind === "pages") !== (n === undefined)) return null;
  return { locale, kind: kind as SitemapKind, chunk: n === undefined ? 0 : Number(n) };
}

/**
 * The records a search engine is offered: reports filed on this site and
 * public, and nothing else.
 *
 * Not the 46,305 imported from GBIF. Each of those pages is one row of
 * TaiRON's dataset, which is already indexed where it was published, and the
 * record page tells a crawler not to index it (noindex, follow) for the
 * reason it is left out here. `reports_public`, so a held, rejected,
 * withheld or test report is never named: the view leaves them out.
 */
const PUBLIC_USER_RECORDS = `from reports_public where source = 'user'`;

/**
 * A read, tried five times over about ten seconds before its failure counts.
 *
 * The sitemaps are drawn at build while 800 species pages are, nine workers
 * with eight connections each, and on a database near its connection limit
 * the sitemap's read was the one turned away ("remaining connection slots
 * are reserved"), three times in a row, two seconds apart. The species pages
 * are done a few seconds later and there is room.
 */
async function patiently<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/** Every sitemap id, in the order the index lists them. */
export async function sitemapIds(): Promise<string[]> {
  let records = 0;
  let species = 0;
  try {
    [{ records, species }] = await patiently(() =>
      asPublic(
        (tx) => tx<{ records: number; species: number }[]>`
          select (select count(*)::int ${tx.unsafe(PUBLIC_USER_RECORDS)}) as records,
                 (select count(*)::int
                    from taxa t
                    left join species_report_stats s on s.taxon_id = t.id
                   where ${tx.unsafe(INDEXWORTHY)}) as species`,
      ),
    );
  } catch (e) {
    // A sitemap without its database entries is a worse sitemap; a build that
    // dies because the database blinked is a worse deploy. So at build the
    // fixed pages and the first species file are still listed, and the next
    // revalidation brings the rest back. After the build the failure is
    // thrown instead, and the index and files already served stay served.
    if (process.env.NEXT_PHASE !== "phase-production-build") throw e;
    console.error(
      "[build] sitemap database entries skipped — database unreachable:",
      (e as Error).message,
    );
  }
  const chunks = (n: number) => Math.ceil(n / PER_SITEMAP);
  // One species file at least, whatever the count: Next asks this list
  // before serving any sitemap, and an id missing from it is answered with a
  // 404 that is then cached like a sitemap. A build whose database blinked
  // once stored zh-TW-species-0.xml as "Not Found" for a day.
  species = Math.max(species, 1);
  const ids: string[] = [];
  for (const locale of routing.locales) {
    ids.push(sitemapId({ locale, kind: "pages", chunk: 0 }));
    for (let c = 0; c < chunks(records); c++) ids.push(sitemapId({ locale, kind: "records", chunk: c }));
    for (let c = 0; c < chunks(species); c++) ids.push(sitemapId({ locale, kind: "species", chunk: c }));
  }
  return ids;
}

/** One file's worth of indexworthy species, by id. */
export async function speciesChunk(
  chunk: number,
): Promise<{ id: number; scientificName: string; updated: Date | null }[]> {
  return patiently(() =>
    asPublic(
      (tx) => tx<{ id: number; scientificName: string; updated: Date | null }[]>`
        select t.id, t.scientific_name as "scientificName",
               greatest(t.updated_at, s.last_seen) as updated
          from taxa t
          left join species_report_stats s on s.taxon_id = t.id
         where ${tx.unsafe(INDEXWORTHY)}
         order by t.id
         limit ${PER_SITEMAP} offset ${chunk * PER_SITEMAP}`,
    ),
  );
}

/** One file's worth of public reports filed here, by id. */
export async function recordChunk(
  chunk: number,
): Promise<{ id: string; created: Date | null }[]> {
  return patiently(() =>
    asPublic(
      (tx) => tx<{ id: string; created: Date | null }[]>`
        select id, created_at as created
          ${tx.unsafe(PUBLIC_USER_RECORDS)}
         order by id
         limit ${PER_SITEMAP} offset ${chunk * PER_SITEMAP}`,
    ),
  );
}
