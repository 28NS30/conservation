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

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-slate-900/50 p-4">
      <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      {hint && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
          {hint}
        </p>
      )}
      <div className="mt-3">{children}</div>
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
  const nav = await getTranslations("nav");

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
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl px-4 pb-16 pt-5">
      <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">
        {nav("backToMap")}
      </Link>

      <h1 className="mt-3 text-xl font-semibold text-slate-50">{t("title")}</h1>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
        {t("intro")}
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
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
            className="rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2.5"
          >
            <dt className="text-[10px] text-slate-500">{t(`metric.${s.k}`)}</dt>
            <dd className="text-base font-semibold tabular-nums text-slate-100">
              {s.v}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 space-y-3">
        {/* One category means one 100% bar, which tells the reader nothing. The
            seed corpus is entirely roadkill; this appears once people report
            other things. */}
        {cats.length > 1 && (
          <Section title={t("byCategory")}>
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
          <p className="mt-2 text-[11px] text-slate-500">
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
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-white/5"
                  >
                    <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-slate-600">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-100">
                        {headline}
                        {s.protectedStatus && (
                          <span className="ml-1.5 rounded bg-amber-400/15 px-1 py-px text-[9px] text-amber-300">
                            {t("protected")}
                          </span>
                        )}
                        {s.isInvasive && (
                          <span className="ml-1.5 rounded bg-rose-400/15 px-1 py-px text-[9px] text-rose-300">
                            {t("invasive")}
                          </span>
                        )}
                      </span>
                      {secondary && (
                        <span className="block truncate text-[11px] italic text-slate-500">
                          {secondary}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm tabular-nums text-slate-200">
                        {n(s.reportCount)}
                      </span>
                      <span className="block text-[10px] tabular-nums text-slate-600">
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
                    pathname: "/",
                    query: {
                      lng: h.lng.toFixed(4),
                      lat: h.lat.toFixed(4),
                      z: "11",
                    },
                  }}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-white/5"
                >
                  <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-slate-600">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-100">
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
                    <span className="block text-[11px] tabular-nums text-slate-500">
                      {h.lat.toFixed(3)}°N, {h.lng.toFixed(3)}°E
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm tabular-nums text-slate-200">
                      {n(h.n)}
                    </span>
                    <span className="block text-[10px] text-slate-600">
                      {t("perCell")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Section>

        <Section title={t("coverage")}>
          <p className="text-xs leading-relaxed text-slate-400">
            {t("coverageBody", {
              obscured: n(ov.obscured),
              total: n(ov.reports),
            })}
          </p>
          <Link
            href="/about"
            className="mt-2 inline-block text-xs text-emerald-400 hover:text-emerald-300"
          >
            {t("howObscuringWorks")} →
          </Link>
        </Section>
      </div>
    </main>
  );
}
