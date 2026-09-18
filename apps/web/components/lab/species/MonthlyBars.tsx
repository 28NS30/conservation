import { peakMonth } from "@/lib/lab/species";
import type { LabCopy } from "@/lib/lab/copy";

/**
 * Twelve months of records, with the numbers written down.
 *
 * Roadkill is strongly seasonal, so this is the most scientifically useful
 * thing the species page holds — and on the live site it is a row of bars whose
 * values exist only inside a tooltip. A tooltip is not readable on a phone, not
 * readable by a screen reader, not printable and not quotable. So the values
 * are text: above their bars from 768px up, and in the `<details>` table the
 * Figure around this draws at every width.
 *
 * The peak bar is drawn in the surface's own text colour rather than in moss,
 * and its value is set a step larger (direction.md §2.5). One bar out of twelve
 * differing in COLOUR and in SIZE is what makes "April is the peak" legible at
 * a glance, in sunlight, and to a reader who cannot tell moss from ink.
 *
 * A server component with no interaction at all: no canvas, no client module,
 * no hover. `aria-hidden` on the graphic is correct precisely because the
 * numbers are elsewhere on the page in text.
 */
export default function MonthlyBars({
  counts,
  copy,
  locale,
  className = "",
}: {
  /** Twelve, January first, exactly as `monthlyCounts` returns them. */
  counts: readonly number[];
  copy: LabCopy;
  locale: string;
  className?: string;
}) {
  const peak = peakMonth(counts);
  const max = Math.max(...counts, 1);

  return (
    <div className={className}>
      {/* Values. Hidden on a phone, where twelve three-digit numbers across
          358px is not reading, it is a texture. The peak's value survives on
          every width because the Figure's heading says it in a sentence. */}
      <div
        aria-hidden="true"
        className="mb-2 hidden items-end gap-2 md:flex"
      >
        {counts.map((n, i) => (
          <span
            key={i}
            className={`min-w-0 flex-1 text-center ${
              i === peak ? "t-lead font-bold text-(--chart-peak)" : "t-note"
            }`}
          >
            {n.toLocaleString(locale)}
          </span>
        ))}
      </div>

      {/* 200px on a phone, 240px above it (§2.5). Fixed, so the percentage
          heights below have something to be a percentage of. */}
      <div
        aria-hidden="true"
        className="flex h-50 items-end gap-1 md:h-60 md:gap-2"
      >
        {counts.map((n, i) => (
          <span
            key={i}
            className="min-w-0 flex-1"
            style={{
              // A hair of height on an empty month, so twelve columns still
              // read as twelve columns and a zero is visibly a zero rather
              // than a gap where a bar failed to draw.
              height: n > 0 ? `${Math.max((n / max) * 100, 1)}%` : "2px",
              background:
                i === peak ? "var(--chart-peak)" : "var(--chart-bar)",
            }}
          />
        ))}
      </div>

      <div aria-hidden="true" className="mt-2 flex gap-1 md:gap-2">
        {counts.map((_, i) => (
          <span
            key={i}
            className={`t-note min-w-0 flex-1 text-center ${
              i === peak ? "font-bold" : "text-(--fg-quiet)"
            }`}
          >
            {copy.species.monthShort[i]}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The same twelve numbers as a table, for the Figure's `<details>`.
 *
 * Not a fallback for the chart — the chart is the fallback for this. A reader
 * who wants to know how many records April holds can read it, copy it and
 * quote it, which is the whole reason `<details>` is in the Figure primitive.
 */
export function MonthlyTable({
  counts,
  copy,
  locale,
}: {
  counts: readonly number[];
  copy: LabCopy;
  locale: string;
}) {
  return (
    <table className="t-note w-full text-left">
      <thead>
        <tr className="rule-strong border-b-2">
          <th scope="col" className="py-2 font-bold">
            {copy.species.monthColumn}
          </th>
          <th scope="col" className="py-2 text-right font-bold">
            {copy.species.countColumn}
          </th>
        </tr>
      </thead>
      <tbody>
        {counts.map((n, i) => (
          <tr key={i} className="rule-quiet border-b">
            <th scope="row" className="py-2 font-normal">
              {copy.species.monthNames[i]}
            </th>
            <td className="py-2 text-right">{n.toLocaleString(locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
