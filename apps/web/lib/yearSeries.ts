/**
 * A count per year, with every year between the first and the last.
 *
 * The yearly chart on /stats drew one column per year that had records, side
 * by side. The imported TaiRON records end in 2017 and this site's own reports
 * began in 2026, so 2017 and 2026 stood next to each other as if one followed
 * the other, and eight empty years vanished from the one chart whose subject
 * is change over time. A year with nothing in it is a zero, drawn and listed.
 *
 * Pure, so the test can hold it without a database.
 */
export function everyYear(rows: { year: number; n: number }[]): { year: number; n: number }[] {
  if (rows.length === 0) return [];
  const byYear = new Map(rows.map((r) => [r.year, r.n]));
  const years = rows.map((r) => r.year);
  const first = Math.min(...years);
  const last = Math.max(...years);
  return Array.from({ length: last - first + 1 }, (_, i) => ({
    year: first + i,
    n: byYear.get(first + i) ?? 0,
  }));
}

/**
 * A year as the chart's axis prints it: ’11 for 2011.
 *
 * Filled, the series runs from the first imported year to this one, sixteen
 * columns about 16px wide on a phone, and the axis is set at 9px and cut to
 * fit, so every "2011" read "20…". Two digits fit. The table under the chart,
 * and the hover, carry the year in full.
 */
export function yearAxis(year: number): string {
  return `’${String(year % 100).padStart(2, "0")}`;
}
