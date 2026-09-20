import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { coverage, SEASON_TARGET, COVERAGE_CELL_M } from "@/lib/coverage";
import PageHeader from "@/components/site/PageHeader";

export const revalidate = 900;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "season" });
  // The lede interpolates the cell size, and a metadata call that forgets it
  // throws FORMATTING_ERROR rather than rendering the raw string.
  return {
    title: t("title"),
    description: t("lede", { km: COVERAGE_CELL_M / 1000 }),
  };
}

/**
 * The shared goal.
 *
 * One number, for everyone, with no account attached — anonymous reports move it
 * exactly as much as signed-in ones, which is the only reading of "community
 * goals, all rewarded" that does not require making accounts compulsory.
 *
 * WHY COVERAGE AND NOT COUNT. A target denominated in records is a bounty on
 * finds, and it pays for the same infestation photographed daily. This one pays
 * only for the FIRST record in a 5 km square, so the second is worth nothing and
 * there is no reason to sit on a known site. It also happens to be what the
 * dataset is actually short of: 46,000 records gathered along surveyed roads
 * describe those roads well and the rest of the island not at all.
 *
 * There is no reward, no currency and no leaderboard here, and that is a
 * decision rather than an omission. Rewarding submission would put a price on
 * records that are published to GBIF under this project's name.
 */
export default async function SeasonPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("season");

  const c = await coverage();
  const km = COVERAGE_CELL_M / 1000;
  const pct = Math.min(100, (c.newThisSeason / SEASON_TARGET) * 100);
  const n = (v: number) => v.toLocaleString(locale);
  const until = new Date(c.seasonEnd).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Taipei",
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24 pt-12">
      <PageHeader title={t("title")} lede={t("lede", { km })} />

      {/* ---------------- the shared number ---------------- */}
      <section className="rounded-xl border border-ink-900/12 bg-paper-100 p-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-ember-700">
          {t("thisSeason", { until })}
        </p>

        <p className="mt-4 flex items-baseline gap-2">
          <span className="text-5xl font-semibold tabular-nums text-ink-900">
            {n(c.newThisSeason)}
          </span>
          <span className="text-lg text-ink-500">/ {n(SEASON_TARGET)}</span>
        </p>
        <p className="mt-1 text-sm text-ink-600">{t("newSquares", { km })}</p>

        {/* aria-hidden: the numbers above already say this, and a progress bar
            announced as "0 percent" adds nothing for a screen reader. */}
        <div
          aria-hidden
          className="mt-5 h-2 overflow-hidden rounded-full bg-ink-900/10"
        >
          <div
            className="h-full rounded-full bg-ember-500 transition-[width]"
            style={{ width: `${Math.max(pct, c.newThisSeason > 0 ? 2 : 0)}%` }}
          />
        </div>

        <p className="mt-5 text-sm leading-relaxed text-ink-600">
          {c.newThisSeason === 0 ? t("noneYet") : t("progress")}
        </p>

        <Link
          href="/report"
          className="mt-6 inline-block rounded-full bg-ember-500 px-5 py-2.5 text-sm font-semibold text-bark-950 transition hover:bg-ember-400"
        >
          {t("cta")}
        </Link>
      </section>

      {/* ---------------- where the map stands ---------------- */}
      <h2 className="mt-12 text-lg font-semibold text-ink-900">
        {t("standingTitle")}
      </h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <Figure
          value={n(c.covered)}
          label={t("cellsCovered", { km })}
          hint={t("cellsHint")}
        />
        <Figure
          value={`${n(c.speciesRecorded)} / ${n(c.speciesInChecklist)}`}
          label={t("speciesCovered")}
          hint={t("speciesHint")}
        />
      </dl>

      <p className="mt-6 text-sm leading-relaxed text-ink-600">
        {t("obscuredNote", { n: n(c.unplaceable), km })}
      </p>

      {/* ---------------- why it is shaped like this ---------------- */}
      <h2 className="mt-12 text-lg font-semibold text-ink-900">
        {t("whyTitle")}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        {t("whyBody", { km })}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        {t("noRewardBody")}
      </p>

      <div className="mt-10 flex flex-wrap gap-3 border-t border-ink-900/10 pt-8">
        <Link
          href="/map"
          className="rounded-full border border-ink-900/20 px-5 py-2.5 text-sm text-ink-800 transition hover:border-ink-900/35 hover:bg-ink-900/5"
        >
          {t("seeMap")}
        </Link>
        <Link
          href="/stats"
          className="rounded-full border border-ink-900/20 px-5 py-2.5 text-sm text-ink-800 transition hover:border-ink-900/35 hover:bg-ink-900/5"
        >
          {t("seeStats")}
        </Link>
      </div>
    </main>
  );
}

function Figure({
  value,
  label,
  hint,
}: {
  value: string;
  label: string;
  hint: string;
}) {
  return (
    // A definition list's group is a `dt` and the `dd`s that describe it, in
    // that order and with nothing else between them. This tile was `dd`, `dt`,
    // `p` — the reading order reversed, and a paragraph where only a `dd` may
    // be — so the list announced a description with no term and then a term
    // with no description. axe calls it `definition-list`.
    //
    // The number still comes first to the eye, by `order` rather than by DOM.
    // The hint is a second `dd`, which is what it is: another description of
    // the same term. Several `dd`s to one `dt` is exactly what the element is
    // for.
    <div className="flex flex-col rounded-lg border border-ink-900/12 bg-paper-100 px-5 py-4">
      <dt className="order-2 mt-1 text-sm text-ink-700">{label}</dt>
      <dd className="order-1 text-2xl font-semibold tabular-nums text-ink-900">
        {value}
      </dd>
      <dd className="order-3 mt-1.5 text-[11px] leading-relaxed text-ink-500">
        {hint}
      </dd>
    </div>
  );
}
