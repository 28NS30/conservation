/**
 * How the forum's lists are ordered: the feeds of threads, and the replies
 * in a thread.
 *
 * Pure, like policy.ts, so test/forum-rank.test.mjs can hold each rule down
 * without a database, and so the page that draws the sort links and the query
 * that sorts agree on what the words in the address mean.
 */

/** Reddit's epoch (8 December 2005). Any fixed instant would do; it keeps the number small. */
export const HOT_EPOCH_SECONDS = 1134028003;
/** Twelve and a half hours: the time it takes ten times the score to wear off. */
export const HOT_DECAY_SECONDS = 45000;

/**
 * A thread's place in the Hot feed: the order of magnitude of its score, plus
 * when it was started, in units of HOT_DECAY_SECONDS.
 *
 * So the first few votes count most (1 to 10 is worth as much as 10 to 100),
 * a thread voted down sinks as fast as one voted up rises, and newer threads
 * gain on older ones at a steady rate whatever their scores. A thread with a
 * score of 10 ranks with one of score 1 started 12.5 hours later.
 *
 * The same sum is the `hot` column of forum_threads_public (migration 0030),
 * which is what the feeds actually sort by; this is here so the rule has a
 * definition that can be tested, and test/forum-votes.test.mjs holds the two
 * equal.
 */
export function hotRank(score: number, createdAt: Date): number {
  const order = Math.log10(Math.max(Math.abs(score), 1));
  return Math.sign(score) * order + (createdAt.getTime() / 1000 - HOT_EPOCH_SECONDS) / HOT_DECAY_SECONDS;
}

export const FEED_SORTS = ["hot", "new", "top"] as const;
export type FeedSort = (typeof FEED_SORTS)[number];

/** The windows Top looks back over: a day, a week, or since the forum began. */
export const TOP_WINDOWS = ["day", "week", "all"] as const;
export type TopWindow = (typeof TOP_WINDOWS)[number];

export const TOP_WINDOW_DAYS: Record<Exclude<TopWindow, "all">, number> = { day: 1, week: 7 };

/**
 * A feed's order from its address, `?sort=top&t=week`.
 *
 * Anything unknown is the default, Hot: a mistyped link gets the front page
 * rather than an error, as a bad `?page=` does (lib/paging.ts). The window
 * only means something for Top, so it is dropped for the others, and a Top
 * with no window is all time.
 */
export function parseFeedSort(sort: unknown, window: unknown): { sort: FeedSort; window: TopWindow } {
  const s = (FEED_SORTS as readonly unknown[]).includes(sort) ? (sort as FeedSort) : "hot";
  if (s !== "top") return { sort: s, window: "all" };
  const w = (TOP_WINDOWS as readonly unknown[]).includes(window) ? (window as TopWindow) : "all";
  return { sort: s, window: w };
}

/**
 * The query string that asks for this order, with the defaults left out so
 * the plain address stays the canonical one.
 */
export function feedQuery(sort: FeedSort, window: TopWindow): Record<string, string> {
  if (sort === "hot") return {};
  if (sort === "new") return { sort };
  return window === "all" ? { sort } : { sort, t: window };
}

export const REPLY_SORTS = ["best", "new"] as const;
export type ReplySort = (typeof REPLY_SORTS)[number];

/** A thread's reply order from `?sort=`: Best unless it says New. */
export function parseReplySort(sort: unknown): ReplySort {
  return sort === "new" ? "new" : "best";
}
