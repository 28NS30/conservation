/**
 * Horizontal proportion bars — used for the category split, where the labels are
 * words rather than a short ordered key and so need the width.
 */
export default function Bars({
  rows,
  total,
  locale,
}: {
  rows: { key: string; label: string; n: number; color: string }[];
  total: number;
  locale: string;
}) {
  if (total === 0) return null;

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const pct = (r.n / total) * 100;
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-parchment-300">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: r.color }}
                />
                <span className="truncate">{r.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-parchment-400">
                {r.n.toLocaleString(locale)}
                <span className="ml-1.5 text-parchment-500">{pct.toFixed(1)}%</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-parchment-50/5">
              <div
                className="h-full rounded-full"
                // Sub-percent slices would otherwise render as nothing at all.
                style={{ width: `${Math.max(0.8, pct)}%`, background: r.color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
