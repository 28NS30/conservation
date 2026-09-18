import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CATEGORIES, type Category } from "@conservation/shared";
import {
  overview,
  categoryCounts,
  monthlyTotals,
  yearlyTotals,
  topSpecies,
  hotspots,
} from "@/lib/stats";
import { speciesSlug } from "@/lib/species";
import PageHeader from "@/components/site/PageHeader";
import Bars from "@/components/stats/Bars";
import Columns from "@/components/stats/Columns";

export const revalidate = 900;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "statsPage" });
  return { title: t("title"), description: t("intro") };
}

/** One panel of the dashboard. `span` makes it take the full grid width. */
function Section({
  title,
  hint,
  span = false,
  children,
}: {
  title: string;
  hint?: string;
  span?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-ink-900/10 bg-paper-100 p-5 ${
        span ? "lg:col-span-2" : ""
      }`}
    >
      <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
      {hint && (
        <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{hint}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function StatsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("statsPage");
  const tc = await getTranslations("categories");

  // Independent aggregates, so issue them together rather than serially.
  const [ov, cats, months, years, species, spots] = await Promise.all([
    overview(),
    categoryCounts(),
    monthlyTotals(),
    yearlyTotals(),
    topSpecies(15),
    hotspots(8),
  ]);

  const n = (v: number) => v.toLocaleString(locale);
  const zhFirst = locale.startsWith("zh");
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { month: "narrow" }).format(
      new Date(Date.UTC(2021, i, 1)),
    ),
  );
  const peak = months.indexOf(Math.max(...months));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pb-24 pt-12">
      <PageHeader title={t("title")} lede={t("intro")} />

      {/* The one number on this site that is a target rather than a
          description. It belongs next to the descriptive ones. */}
      <Link
        href="/season"
        className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-ember-500/30 bg-ember-500/8 px-5 py-4 transition hover:border-ember-500/50 hover:bg-ember-500/12"
      >
        <span>
          <span className="block text-sm font-semibold text-ink-900">
            {t("seasonLink")}
          </span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-600">
            {t("seasonLinkHint")}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-ember-700">
          →
        </span>
      </Link>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: "records", v: n(ov.reports) },
          { k: "species", v: n(ov.species) },
          {
            k: "identified",
            v: ov.reports
              ? `${Math.round((ov.identified / ov.reports) * 100)}%`
              : "—",
          },
          {
            k: "range",
            v:
              ov.firstYear && ov.lastYear
                ? `${ov.firstYear}–${ov.lastYear}`
                : "—",
          },
        ].map((s) => (
          <div
            key={s.k}
            className="rounded-lg border border-ink-900/10 bg-paper-100 px-4 py-3.5"
          >
            <dt className="text-[11px] text-ink-500">{t(`metric.${s.k}`)}</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink-800">
              {s.v}
            </dd>
          </div>
        ))}
      </dl>

      {/* A dashboard, not a column. Every panel here is short and wide-ish, and
          stacking them single-file made a 640px ribbon down a 1180px page with
          six screens of scrolling. `items-start` keeps a short panel from being
          stretched to match a tall one beside it. */}
      {/* `grid-cols-1` is not decoration. A grid with no column template at all
          falls back to one implicit column sized to its content, so the widest
          thing inside — a long Latin name, a hotspot's count — pushed the whole
          page wider than the phone it was on: /en/stats laid out 421px inside a
          390px viewport and scrolled sideways. Naming one column makes it
          minmax(0, 1fr), which is what every child here already assumes. */}
      <div className="mt-4 grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        {/* One category means one 100% bar, which tells the reader nothing. The
            seed corpus is entirely roadkill; this appears once people report
            other things. */}
        {cats.length > 1 && (
          <Section title={t("byCategory")} span>
            <Bars
              total={ov.reports}
              locale={locale}
              rows={cats.map((c) => ({
                key: c.category,
                label: c.category in CATEGORIES ? tc(c.category) : c.category,
                n: c.n,
                color: CATEGORIES[c.category as Category]?.color ?? "#94a3b8",
              }))}
            />
          </Section>
        )}

        <Section title={t("seasonality")} hint={t("seasonalityHint")}>
          <Columns
            label={t("seasonality")}
            highlight={peak}
            data={months.map((v, i) => ({ key: monthNames[i], n: v }))}
          />
          <p className="mt-2 text-[11px] text-ink-500">
            {t("peakMonth", {
              month: new Intl.DateTimeFormat(locale, { month: "long" }).format(
                new Date(Date.UTC(2021, peak, 1)),
              ),
            })}
          </p>
        </Section>

        {years.length > 1 && (
          <Section title={t("byYear")} hint={t("byYearHint")}>
            <Columns
              label={t("byYear")}
              data={years.map((y) => ({ key: String(y.year), n: y.n }))}
            />
          </Section>
        )}

        <Section title={t("topSpecies")} hint={t("topSpeciesHint")}>
          <ol className="space-y-1">
            {species.map((s, i) => {
              const headline =
                zhFirst && s.commonNameZh ? s.commonNameZh : s.scientificName;
              const secondary =
                zhFirst && s.commonNameZh ? s.scientificName : s.commonNameZh;
              const share = ov.reports ? (s.reportCount / ov.reports) * 100 : 0;
              return (
                <li key={s.id}>
                  <Link
                    href={`/species/${speciesSlug(s)}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-ink-900/5"
                  >
                    <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-500">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-800">
                        {headline}
                        {s.protectedStatus && (
                          <span className="ml-1.5 rounded bg-amber-400/15 px-1 py-px text-[9px] text-amber-700">
                            {t("protected")}
                          </span>
                        )}
                        {s.isInvasive && (
                          <span className="ml-1.5 rounded bg-rose-400/15 px-1 py-px text-[9px] text-rose-700">
                            {t("invasive")}
                          </span>
                        )}
                      </span>
                      {secondary && (
                        <span className="block truncate text-[11px] italic text-ink-500">
                          {secondary}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm tabular-nums text-ink-700">
                        {n(s.reportCount)}
                      </span>
                      <span className="block text-[10px] tabular-nums text-ink-500">
                        {share.toFixed(1)}%
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Section>

        <Section title={t("hotspots")} hint={t("hotspotsHint")}>
          <ol className="space-y-1">
            {spots.map((h, i) => (
              <li key={`${h.lng},${h.lat}`}>
                <Link
                  href={{
                    // /map, not /: the full-screen map moved off the home page
                    // when the landing page took it over, and this link was left
                    // pointing at the marketing hero.
                    pathname: "/map",
                    query: {
                      lng: h.lng.toFixed(4),
                      lat: h.lat.toFixed(4),
                      z: "11",
                    },
                  }}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-ink-900/5"
                >
                  <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-500">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-800">
                      {h.topSpeciesZh || h.topSpeciesSci
                        ? t("dominatedBy", {
                            species:
                              (zhFirst && h.topSpeciesZh) ||
                              h.topSpeciesSci ||
                              h.topSpeciesZh ||
                              "",
                          })
                        : t("mixedSpecies")}
                    </span>
                    <span className="block text-[11px] tabular-nums text-ink-500">
                      {h.lat.toFixed(3)}°N, {h.lng.toFixed(3)}°E
                    </span>
                  </span>
                  {/* One line: stacked, the lone unit character read as a
                      stray glyph floating under the count. */}
                  <span className="shrink-0 whitespace-nowrap text-[10px] tabular-nums text-ink-500">
                    <span className="text-sm text-ink-700">{n(h.n)}</span>{" "}
                    {t("perCell")}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Section>

        <Section title={t("coverage")} span>
          <p className="text-xs leading-relaxed text-ink-500">
            {t("coverageBody", {
              obscured: n(ov.obscured),
              total: n(ov.reports),
            })}
          </p>
          <Link
            href="/about"
            className="mt-2 inline-block text-xs text-ember-700 transition hover:underline"
          >
            {t("howObscuringWorks")} →
          </Link>
        </Section>
      </div>
    </main>
  );
}
