import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * The 404 for a path inside a locale that asked for something missing — a
 * species id or a record that does not exist. Unmatched URLs get
 * app/global-not-found.tsx instead.
 *
 * The two ways out were 12px pills 30px tall, the smallest targets on a page
 * whose only job is getting the reader somewhere else. They are 48px now, and
 * the page is set in the team's design like every other: the display face,
 * the orange rule, square buttons.
 */
export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-6 py-12">
      <p className="font-display text-6xl font-bold leading-none tabular-nums text-forest-900">404</p>
      <span aria-hidden className="mt-4 block h-1 w-14 bg-ember-500" />
      <h1 className="mt-5 text-2xl font-semibold text-ink-900">{t("notFoundTitle")}</h1>
      <p className="mt-2 text-[17px] leading-relaxed text-ink-800">{t("notFoundBody")}</p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link href="/" className="inline-flex min-h-12 items-center bg-ember-500 px-6 font-display text-[17px] font-bold uppercase tracking-[0.06em] text-ink-950 transition hover:bg-ember-400">
          {t("backHome")}
        </Link>
        <Link href="/species" className="inline-flex min-h-12 items-center border-2 border-forest-900 px-6 font-display text-[17px] font-bold uppercase tracking-[0.06em] text-forest-900 transition hover:bg-forest-900/5">
          {t("browseSpecies")}
        </Link>
      </div>
    </main>
  );
}
