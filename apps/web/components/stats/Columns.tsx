/**
 * Vertical bar chart for an ordered series (months, years).
 *
 * Deliberately plain DOM rather than a charting library: it is a dozen divs, it
 * server-renders with no client JS, and it stays readable with a screen reader
 * because the real content is the table in `aria-label` territory below — see the
 * caption and per-bar titles.
 */
export default function Columns({
  data,
  label,
  height = 64,
  highlight,
}: {
  data: { key: string; n: number }[];
  label: string;
  height?: number;
  /** Index to emphasise, e.g. the peak month. */
  highlight?: number;
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
          // Keyed by position, not label: narrow month names are not unique in
          // every locale (English gives J,F,M,A,M,J,J,A,S,O,N,D).
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
              title={`${d.key}: ${d.n.toLocaleString()}`}
            />
            <span className="truncate text-[9px] tabular-nums text-ink-500">
              {d.key}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}
