import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ComponentProps } from "react";
import type { PageWindow } from "@/lib/paging";

type Href = ComponentProps<typeof Link>["href"];

/**
 * Previous / page N / next, for any paged list.
 *
 * The caller builds the hrefs, because only the caller knows what else is in
 * its address — the directory carries a query and a filter, the report list
 * carries a species and a date range, and a pager that built its own links
 * would be the third place in the codebase to drop them.
 *
 * Nothing is rendered when the whole list fits on one page: a lone "Page 1"
 * under a short list is a control that does nothing, and reads as a promise of
 * more.
 */
export default async function Pager({
  window: w,
  hrefFor,
}: {
  window: PageWindow;
  hrefFor: (page: number) => Href;
}) {
  const t = await getTranslations("list");
  if (w.totalPages <= 1) return null;

  // 44px tall, which is the reason for the flex box rather than the padding:
  // the previous links were a line of 15px text, and a target that small at
  // the bottom of a long list is missed by a thumb on a moving bus.
  const link =
    "inline-flex min-h-11 items-center px-2 text-ink-600 transition hover:text-ink-800";

  return (
    <nav
      aria-label={t("pagination")}
      className="mt-6 flex items-center justify-between text-xs"
    >
      {w.hasPrev ? (
        <Link href={hrefFor(w.page - 1)} rel="prev" className={link}>
          ← {t("previous")}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-ink-500">{t("pageN", { page: w.page })}</span>
      {w.hasNext ? (
        <Link href={hrefFor(w.page + 1)} rel="next" className={link}>
          {t("next")} →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
