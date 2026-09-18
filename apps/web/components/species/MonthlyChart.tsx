import { useTranslations, useLocale } from "next-intl";
import ChartTable from "@/components/stats/ChartTable";

/**
 * Monthly distribution of records.
 *
 * Roadkill is strongly seasonal — amphibians in the spring migration, snakes in
 * the warm months — so for a species with enough records this is the most
 * scientifically interesting thing on the page. Which is also why its numbers
 * cannot live in a `title`: a hover is not available on a phone, to a keyboard,
 * or to a screen reader, and this is the figure people actually want to read
 * off.
 */
export default function MonthlyChart({ counts }: { counts: number[] }) {
  const t = useTranslations("species");
  const ts = useTranslations("stats");
  const locale = useLocale();
  const max = Math.max(...counts);
  if (max === 0) return null;

  const total = counts.reduce((a, b) => a + b, 0);
  const monthName = (i: number) =>
    new Intl.DateTimeFormat(locale, { month: "long" }).format(
      new Date(Date.UTC(2021, i, 1)),
    );

  return (
    <figure>
      <figcaption className="text-xs font-medium uppercase tracking-wide text-ink-500">
        {t("seasonality")}
      </figcaption>
      <div className="mt-2 flex items-end gap-1" role="img" aria-label={t("seasonality")}>
        {counts.map((n, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-sm bg-moss-700/70"
              style={{ height: `${Math.max(2, (n / max) * 56)}px` }}
              title={`${monthName(i)}: ${n.toLocaleString(locale)}`}
            />
            <span className="text-[9px] tabular-nums text-ink-500">
              {(i + 1).toLocaleString(locale)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-ink-500">
        {t("seasonalityHint", { total, peak: counts.indexOf(max) + 1 })}
      </p>
      <ChartTable
        caption={t("seasonality")}
        keyHeader={ts("month")}
        valueHeader={ts("count")}
        summary={ts("showNumbers")}
        locale={locale}
        rows={counts.map((n, i) => ({
          key: String(i),
          label: monthName(i),
          n,
        }))}
      />
    </figure>
  );
}
