import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Category } from "@/lib/forum/queries";
import { link } from "./styles";

/**
 * The list of communities, Reddit's sidebar: the forum's categories, each
 * with its own page and feed.
 *
 * Two shapes of the same links. On a phone, a row of names above the feed,
 * where a thumb finds them before the first thread; on a wide screen, a
 * column beside it with what each one is for. Only one is ever displayed, and
 * the other is display:none, which hides it from screen readers too.
 */
export async function CommunityChips({ categories, current, zh }: { categories: Category[]; current?: string; zh: boolean }) {
  const t = await getTranslations("forum");
  return (
    <nav aria-label={t("categories")} className="mb-6 lg:hidden">
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link
            href="/community"
            aria-current={current === undefined ? "page" : undefined}
            className={chip(current === undefined)}
          >
            {t("allCommunities")}
          </Link>
        </li>
        {categories.map((c) => (
          <li key={c.id}>
            <Link
              href={`/community/c/${c.slug}`}
              aria-current={current === c.slug ? "page" : undefined}
              className={chip(current === c.slug)}
            >
              {zh ? c.name_zh : c.name_en}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export async function CommunitySidebar({ categories, current, zh }: { categories: Category[]; current?: string; zh: boolean }) {
  const t = await getTranslations("forum");
  return (
    <aside className="hidden lg:block">
      <nav aria-labelledby="communities-title" className="border border-ink-900/12 bg-white/60 px-4 py-4">
        <h2 id="communities-title" className="text-[16px] font-semibold text-forest-900">
          {t("categories")}
        </h2>
        <ul className="mt-2 divide-y divide-ink-900/10">
          <li>
            <Link
              href="/community"
              aria-current={current === undefined ? "page" : undefined}
              className="flex min-h-11 items-center py-2 text-[15px] font-semibold text-forest-900 underline-offset-2 hover:underline aria-[current=page]:underline"
            >
              {t("allCommunities")}
            </Link>
          </li>
          {categories.map((c) => (
            <li key={c.id} className="py-2">
              <Link
                href={`/community/c/${c.slug}`}
                aria-current={current === c.slug ? "page" : undefined}
                className="flex min-h-11 items-center text-[15px] font-semibold text-forest-900 underline-offset-2 hover:underline aria-[current=page]:underline"
              >
                {zh ? c.name_zh : c.name_en}
              </Link>
              <p className="text-[14px] leading-relaxed text-ink-700">{zh ? c.description_zh : c.description_en}</p>
              <p className="mt-1 text-[14px] text-ink-600">{t("threadCount", { count: c.thread_count })}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-ink-900/10 pt-3 text-[14px] leading-relaxed text-ink-700">
          {t("reminder")}{" "}
          <Link href="/community/guidelines" className={`${link} inline-flex min-h-11 items-center`}>
            {t("guidelines")}
          </Link>
        </p>
      </nav>
    </aside>
  );
}

const chip = (current: boolean) =>
  `inline-flex min-h-11 items-center rounded-full border px-4 text-[15px] transition ${
    current
      ? "border-forest-900 bg-forest-900 text-paper-50"
      : "border-ink-900/20 bg-white/60 text-forest-900 hover:border-forest-900/50"
  }`;
