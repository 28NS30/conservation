/**
 * The numbers behind a bar chart, as a table.
 *
 * Every chart on this site carried its values in a `title` attribute and
 * nowhere else. A title is a hover: it does not exist on a phone, it does not
 * exist to a keyboard, and a screen reader reads it inconsistently or not at
 * all — so on the page whose job is publishing numbers, the numbers were
 * available only to someone with a mouse. The bars stay, because a shape is
 * what a chart is for; this is the same data said again in a form anything can
 * read.
 *
 * Closed by default, and a <details> rather than a visually-hidden table,
 * because it is useful to sighted readers too — "which month exactly" is the
 * commonest question a twelve-column chart provokes, and the answer was a
 * tooltip.
 *
 * Every label arrives as a prop. The two callers live in different message
 * namespaces, and a component that fetched its own words would have to pick one
 * of them or introduce a third.
 */
export default function ChartTable({
  caption,
  keyHeader,
  valueHeader,
  summary,
  rows,
  locale,
}: {
  /** Names the table; the same words as the chart's own caption. */
  caption: string;
  /** 月份 / Month, or 年份 / Year. */
  keyHeader: string;
  /** 筆數 / Records. */
  valueHeader: string;
  /** The disclosure's own label: 顯示數字 / Show the numbers. */
  summary: string;
  rows: { key: string; label: string; n: number }[];
  locale: string;
}) {
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-[11px] text-ink-600 hover:text-ink-800">
        {summary}
      </summary>
      <table className="mt-1 w-full max-w-xs text-left text-[11px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-ink-500">
          <tr>
            <th scope="col" className="py-1 font-medium">
              {keyHeader}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {valueHeader}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-ink-900/10">
              <th scope="row" className="py-1 font-normal text-ink-600">
                {r.label}
              </th>
              <td className="py-1 text-right tabular-nums text-ink-700">
                {r.n.toLocaleString(locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
