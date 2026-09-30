import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { FEED_SORTS, REPLY_SORTS, TOP_WINDOWS, feedQuery, type FeedSort, type ReplySort, type TopWindow } from "@/lib/forum/rank";

/**
 * The orders a list can be read in, as links: plain GET addresses, so they
 * work without JavaScript, can be bookmarked and shared, and the back button
 * goes back to the order you had. The current one is marked aria-current.
 */

const pill = (current: boolean) =>
  `inline-flex min-h-11 items-center rounded-full border px-4 text-[15px] transition ${
    current
      ? "border-forest-900 bg-forest-900 text-paper-50"
      : "border-ink-900/20 bg-paper-50 text-ink-800 hover:border-ink-900/50 hover:bg-paper-100"
  }`;

/** Hot, New and Top for a feed; with Top, the window it looks back over. */
export async function FeedSortNav({ path, sort, window }: { path: string; sort: FeedSort; window: TopWindow }) {
  const t = await getTranslations("forum.sort");
  return (
    <nav aria-label={t("feedLabel")} className="mb-4">
      <ul className="flex flex-wrap gap-2">
        {FEED_SORTS.map((s) => (
          <li key={s}>
            <Link
              href={{ pathname: path, query: feedQuery(s, s === "top" ? window : "all") }}
              aria-current={s === sort ? "true" : undefined}
              className={pill(s === sort)}
            >
              {t(s)}
            </Link>
          </li>
        ))}
      </ul>
      {sort === "top" && (
        <ul aria-label={t("windowLabel")} className="mt-2 flex flex-wrap gap-2">
          {TOP_WINDOWS.map((w) => (
            <li key={w}>
              <Link
                href={{ pathname: path, query: feedQuery("top", w) }}
                aria-current={w === window ? "true" : undefined}
                className={pill(w === window)}
              >
                {t(`window.${w}`)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

/** Best and New for a thread's replies. Each lands back on the replies, not the top of the page. */
export async function ReplySortNav({ path, sort }: { path: string; sort: ReplySort }) {
  const t = await getTranslations("forum.sort");
  return (
    <nav aria-label={t("replyLabel")}>
      <ul className="flex flex-wrap gap-2">
        {REPLY_SORTS.map((s) => (
          <li key={s}>
            <Link
              href={{ pathname: path, query: s === "best" ? {} : { sort: s }, hash: "replies" }}
              aria-current={s === sort ? "true" : undefined}
              className={pill(s === sort)}
            >
              {t(s)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
