import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ComponentProps } from "react";

type Href = ComponentProps<typeof Link>["href"];

/**
 * Previous / page N / next, for any paged list.
 *
 * Deliberately told only where it is and whether there is more, rather than
 * given a total: the species directory knows its total because it counts, and
 * the report list knows only that it asked for one row more than it shows. Both
 * are legitimate, and a pager that demanded a total would force a count query
 * onto the page that does not need one.
 *
 * The caller builds the hrefs for the same reason — only the caller knows what
 * else is in its address. The directory carries a search and a filter, the
 * report list a species and a date range, and a pager that built its own links
 * would be the next place in the codebase to drop them.
 */
export default async function Pager({
  page,
  hasPrev,
  hasNext,
  hrefFor,
}: {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  hrefFor: (page: number) => Href;
}) {
  const t = await getTranslations("list");
  // Nothing at all when the whole list fits on one page: a lone "Page 1" under
  // a short list is a control that does nothing and reads as a promise of more.
  if (!hasPrev && !hasNext) return null;

  // 44px tall, which is what the flex box is for rather than the padding: these
  // were a line of 15px text at the bottom of a long list, which is a target a
  // thumb misses on a moving bus.
  const link =
    "inline-flex min-h-11 items-center px-2 text-ink-600 transition hover:text-ink-800";

  return (
    <nav
      aria-label={t("pagination")}
      className="mt-6 flex items-center justify-between text-xs"
    >
      {hasPrev ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={link}>
          ← {t("previous")}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-ink-500">{t("pageN", { page })}</span>
      {hasNext ? (
        <Link href={hrefFor(page + 1)} rel="next" className={link}>
          {t("next")} →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
