import { revalidateTag, unstable_cache } from "next/cache";

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
 * Which is why a cached page that shows records reads them through here even
 * where the read is cheap: a species page's taxon, its monthly counts and its
 * list of records with their points (lib/species.ts), a collection's newest
 * records. The tag on what a page read is the only thing that drops the page
 * when a record is re-identified, blurred or thrown out; without it the page
 * kept the record's old point until it next happened to be rebuilt.
 * test/site-figures.test.mjs walks every cached page for a read of the
 * records that does not come through here.
 *
 * Five minutes is a figure's age when it is used, not how long a page may
 * show it. A page rebuilt from one keeps it for its own `revalidate`, and is
 * served stale for at most `expireTime` (next.config.ts), so a blur tightened
 * in the database, where no writer calls `reportsChanged()`, is off every
 * page within that hour and these five minutes. Rebuilding a page waits for
 * its stale figures to be read again rather than reusing them, so the two
 * never chain.
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
 * A change made in the database itself, a migration's re-blur or a floor,
 * calls nothing. It reaches every page within the bound `expireTime` sets
 * (next.config.ts); when it cannot wait that long, a production deploy is
 * the purge.
 */
export function reportsChanged(): void {
  revalidateTag(REPORTS_TAG, { expire: 0 });
}
