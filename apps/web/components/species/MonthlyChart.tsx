import { useTranslations } from "next-intl";

/**
 * Monthly distribution of records.
 *
 * Roadkill is strongly seasonal — amphibians in the spring migration, snakes in
 * the warm months — so for a species with enough records this is the most
 * scientifically interesting thing on the page.
 */
export default function MonthlyChart({ counts }: { counts: number[] }) {
  const t = useTranslations("species");
  const max = Math.max(...counts);
  if (max === 0) return null;

  const total = counts.reduce((a, b) => a + b, 0);

  return (
    <figure>
      <figcaption className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {t("seasonality")}
      </figcaption>
      <div className="mt-2 flex items-end gap-1" role="img" aria-label={t("seasonality")}>
        {counts.map((n, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-sm bg-emerald-400/70"
              style={{ height: `${Math.max(2, (n / max) * 56)}px` }}
              title={`${i + 1}: ${n}`}
            />
            <span className="text-[9px] tabular-nums text-slate-500">{i + 1}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        {t("seasonalityHint", { total, peak: counts.indexOf(max) + 1 })}
      </p>
    </figure>
  );
}
