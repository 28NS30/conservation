/**
 * The day something happened, on Taiwan's calendar.
 *
 * A record's time is stored as an instant, and which day that instant falls on
 * depends on where the calendar hangs: 2026-09-30T22:30Z is half past six on
 * the morning of 1 October in Taipei. The map's record panel printed
 * `observedAt.slice(0, 10)`, the day in UTC, so an animal found before eight in
 * the morning was shown as found the day before, beside a record page and a
 * list that said otherwise. Every record here is a Taiwan record and every
 * page states its days in Taipei; this is that rule in one place.
 *
 * Pure, so a client component can call it and a test can hold it. The zone
 * always wins over the options passed in.
 */
export const TAIPEI = "Asia/Taipei";

export function formatTaipeiDate(
  value: string | Date,
  locale: string,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {},
): string {
  return new Date(value).toLocaleDateString(locale, { ...options, timeZone: TAIPEI });
}
