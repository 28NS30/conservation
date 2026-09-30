import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * Previous / page N / next for the forum's lists.
 *
 * The site's Pager (components/site/Pager.tsx) sets its labels at 12px; the
 * forum's floor is 14px, and changing the shared one would restyle every list
 * on the site from a branch that is not about them. Same contract otherwise:
 * told where it is and whether there is more, and given the hrefs.
 *
 * `query` is what else the address says, such as the order a feed is sorted
 * in, so page 2 of Top this week is not page 2 of Hot.
 */
export default async function ForumPager({
  page,
  hasPrev,
  hasNext,
  path,
  query = {},
  hash,
}: {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  path: string;
  query?: Record<string, string>;
  hash?: string;
}) {
  const t = await getTranslations("list");
  if (!hasPrev && !hasNext) return null;
  const href = (p: number) => ({
    pathname: path,
    query: p > 1 ? { ...query, page: String(p) } : query,
    ...(hash ? { hash } : {}),
  });
  const cls = "inline-flex min-h-11 items-center px-2 text-[15px] text-leaf-700 underline-offset-2 hover:underline";
  return (
    <nav aria-label={t("pagination")} className="mt-6 flex items-center justify-between">
      {hasPrev ? (
        <Link href={href(page - 1)} rel="prev" className={cls}>
          ← {t("previous")}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-[14px] text-ink-600">{t("pageN", { page })}</span>
      {hasNext ? (
        <Link href={href(page + 1)} rel="next" className={cls}>
          {t("next")} →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
