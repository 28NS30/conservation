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
 * Only for figures that are the same for every reader: what is cached here
 * is served to anyone who asks. Nothing that depends on who is looking, and
 * nothing read on the privileged connection that the public view would not
 * show.
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
 * report is published, rejected or given another species.
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
 */
export function reportsChanged(): void {
  revalidateTag(REPORTS_TAG, { expire: 0 });
}
