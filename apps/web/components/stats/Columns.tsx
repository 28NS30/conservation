import ChartTable from "./ChartTable";

/**
 * Vertical bar chart for an ordered series (months, years).
 *
 * Deliberately plain DOM rather than a charting library: it is a dozen divs, it
 * server-renders with no client JS, and it stays inspectable.
 *
 * The figure is a shape and a table, not a shape alone. The bars carry
 * role="img" with the series name, which is all a screen reader can usefully be
 * told about a picture; the values live in the ChartTable below, because they
 * used to live only in a `title` attribute — a hover, which a phone and a
 * keyboard do not have.
 */
export default function Columns({
  data,
  label,
  height = 64,
  highlight,
  locale,
  table,
}: {
  /**
   * `key` is the axis label, kept short enough to fit a 16px column. `label` is
   * the same point written out — the long month name — for the table and the
   * hover, where there is room for it.
   */
  data: { key: string; label?: string; n: number }[];
  label: string;
  height?: number;
  /** Index to emphasise, e.g. the peak month. */
  highlight?: number;
  locale: string;
  /** Column headings and the disclosure label, in the caller's namespace. */
  table: { keyHeader: string; valueHeader: string; summary: string };
}) {
  const max = Math.max(...data.map((d) => d.n), 0);
  if (max === 0) return null;

  return (
    <figure>
      {/* Visually hidden: every caller sits under a heading that already says
          this. Kept in the DOM so the figure is still named for a screen reader. */}
      <figcaption className="sr-only">{label}</figcaption>
      <div className="mt-2 flex items-end gap-1" role="img" aria-label={label}>
        {data.map((d, i) => (
          // Keyed by position, not label: two points in a series can share an
          // axis label, and the axis label is deliberately the short form.
          <div
            key={i}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            <div
              className={`w-full rounded-sm transition-colors ${
                i === highlight ? "bg-ember-400" : "bg-moss-700/70"
              }`}
              // Always at least 2px: a zero-height bar reads as missing data
              // rather than as a genuine zero.
              style={{ height: `${Math.max(2, (d.n / max) * height)}px` }}
              title={`${d.label ?? d.key}: ${d.n.toLocaleString(locale)}`}
            />
            <span className="truncate text-[9px] tabular-nums text-ink-500">
              {d.key}
            </span>
          </div>
        ))}
      </div>
      <ChartTable
        caption={label}
        keyHeader={table.keyHeader}
        valueHeader={table.valueHeader}
        summary={table.summary}
        locale={locale}
        rows={data.map((d, i) => ({
          key: String(i),
          label: d.label ?? d.key,
          n: d.n,
        }))}
      />
    </figure>
  );
}
