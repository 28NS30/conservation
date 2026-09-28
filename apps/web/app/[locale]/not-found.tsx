import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * The 404 for a path inside a locale that asked for something missing — a
 * species id or a record that does not exist. Unmatched URLs get
 * app/global-not-found.tsx instead.
 *
 * The two ways out were 12px pills 30px tall, the smallest targets on a page
 * whose only job is getting the reader somewhere else. They are 48px now.
 */
export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-3xl font-semibold text-ink-500">404</p>
      <h1 className="mt-2 text-xl font-semibold text-ink-800">{t("notFoundTitle")}</h1>
      <p className="mt-2 text-sm text-ink-600">{t("notFoundBody")}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link
          href="/"
          className="inline-flex min-h-12 items-center rounded-full bg-ember-500 px-5 text-sm font-semibold text-bark-950 hover:bg-ember-400"
        >
          {t("backHome")}
        </Link>
        <Link
          href="/species"
          className="inline-flex min-h-12 items-center rounded-full border border-ink-900/15 px-5 text-sm text-ink-700 hover:bg-paper-200"
        >
          {t("browseSpecies")}
        </Link>
      </div>
    </main>
  );
}
