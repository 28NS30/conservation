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
