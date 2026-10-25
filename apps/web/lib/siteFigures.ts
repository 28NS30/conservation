import { revalidateTag, unstable_cache } from "next/cache";
import { after } from "next/server";

/**
 * The figures the whole site states, computed once for everybody.
 *
 * How many records, how many species, the /stats panels: each is a full pass
 * over reports_public, several through species_report_stats, which is a view
 * and aggregates the whole table again on every read. Every page view ran
 * them afresh, and the species count alone was called 10,505 times in
 * production at a mean of 241 ms. They change only when a report is
 * published or re-identified, which is a handful of times a day.
 *
 * So each is cached in Next's data cache, which on Vercel every function
 * instance shares, for at most five minutes, and is dropped at once by
 * `reportsChanged()` wherever the reports change. A page built from one also
 * carries the tag, so a cached page is rebuilt with it.
 *
 * Which is why a cached page that shows records reads something through
 * here even where the read is cheap: a species page's taxon and its monthly
 * counts (lib/species.ts), a collection's newest records. The tag on what a
 * page read is the only thing that drops the page when a record is
 * re-identified, blurred or thrown out.
 *
 * Except a record's point, which is never read through here. A figure may be
 * up to five minutes old when a page is rebuilt from it, and the page is then
 * served for up to ten more (`expireTime`, next.config.ts): a point read
 * through the cache kept a blur tightened in the database, where no writer
 * calls `reportsChanged()`, on a species page for fifteen minutes. So every
 * read that places a record (the hotspots, the anniversary ledger, a sparse
 * species' list) is made afresh, through freshPoints() below or per request,
 * and is never older than the page it is on; the page carries the tag through
 * the other figures it reads. test/site-figures.test.mjs walks every cached
 * page for a read of the records that comes through neither, for a page whose
 * untagged reads ride on no tagged one, and for a point behind any cache.
 *
 * When the database fails, the page bound needs that too. A rebuild that
 * throws keeps the previous page: Next stores it again with a `revalidate` of
 * thirty seconds and an `expire` of ten minutes from then, so every failed
 * retry, one a visit at most every thirty seconds, serves the old copy for up
 * to ten minutes more, and a page past its expire whose blocking rebuild
 * fails is put back the same way (response-cache/index.js,
 * retainPreviousCacheEntry). A cached figure does not throw once it has a
 * copy: a stale one whose read fails is handed to the rebuild as it was (Next
 * logs "revalidating cache with key"). So the reads that can make a rebuild
 * throw are the uncached ones, and the ones that place records answer no
 * points rather than throw: the rebuild succeeds, and the old points go with
 * the old page, at the bound, outage or not. What the bound then does not
 * cover is a page whose rebuild throws anyway, which is a page with a cached
 * figure it has no copy of at all (the data cache evicted it, or it was never
 * read on this deployment) while the database is down: that page keeps its
 * old copy until a rebuild succeeds. A re-blur made during an outage wants a
 * deploy (docs/launch-checklist.md).
 *
 * Only for what is the same for every reader: what is cached here is served
 * to anyone who asks. Nothing that depends on who is looking, and nothing
 * read on the privileged connection that the public view would not show.
 */
export const REPORTS_TAG = "reports";

const FIVE_MINUTES = 300;

/**
 * `read`, cached under `name` and its arguments. The name is part of the key
 * so that two figures can never share an entry, whatever their source.
 */
export function siteFigure<A extends unknown[], R>(
  name: string,
  read: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return unstable_cache(read, ["site-figure", name], {
    revalidate: FIVE_MINUTES,
    tags: [REPORTS_TAG],
  });
}

/**
 * A read that places records, `read`, made afresh each time it is asked; and
 * no records at all when the database cannot answer.
 *
 * Afresh, because a point may be no older than the page it is on (above).
 * None rather than an error, because an error is what keeps an old page, old
 * points and all: a page whose rebuild throws is stored again as it was. With
 * nothing to place, the rebuild succeeds and the page shows no places until
 * it is next rebuilt, five minutes on at most.
 */
export async function freshPoints<R>(name: string, read: () => Promise<R[]>): Promise<R[]> {
  try {
    return await read();
  } catch (e) {
    console.error(`[${name}] no records placed, the database did not answer:`, (e as Error).message);
    return [];
  }
}

/**
 * Long enough for a rebuild that started before the write to have stored
 * its copy, the reads of a page being a few hundred milliseconds; short
 * enough to fit in what is left of any function's time once it has
 * answered.
 */
const AGAIN_AFTER_MS = 5_000;

/**
 * Drop every cached figure, and every cached page built from one, after a
 * report is published, rejected, given another species, or blurred.
 *
 * `expire: 0` rather than serving the old figures once more while new ones
 * are made: these change a few times a day, and the person who has just
 * published a report, or named its animal, opens the map or the record next
 * and should find it counted. The next reader of each figure waits for one
 * query, once.
 *
 * Only from a Server Action or a Route Handler, after the write has
 * committed: called before, the next reader could cache the old figures
 * again for five minutes.
 *
 * And once more, AGAIN_AFTER_MS later, from after(). The first drop leaves
 * two things standing. A rebuild that read before the write committed but
 * stored its copy after the drop is newer than the drop, so it counts as
 * fresh, old figures and all, for its five minutes. And a drop that fails,
 * the platform's purge not answering, is not tried again. The second drop
 * expires the first kind, which has had five seconds to land, and is the
 * retry for the second. Inside an after() of its own (the classify run that
 * follows a submission) the two are one: Next carries out what after()
 * callbacks revalidate once they have all finished, so there the drop
 * happens once, five seconds after the run.
 *
 * A change made in the database itself, a migration's re-blur or a floor,
 * calls nothing. Its points are off every page within ten minutes, and its
 * counts within fifteen (above); when that cannot wait, a production deploy
 * is the purge.
 */
export function reportsChanged(): void {
  revalidateTag(REPORTS_TAG, { expire: 0 });
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, AGAIN_AFTER_MS));
    revalidateTag(REPORTS_TAG, { expire: 0 });
  });
}

