/**
 * When the photograph was taken, read from EXIF.
 *
 * A reporter photographs an animal at 07:32 and files the report at 19:40 when
 * they get home and find signal. Stamping the record with the submission time
 * moves it half a day, and on a dataset whose whole point is when and where
 * animals are found, half a day is not a rounding error — it moves a dawn
 * roadkill peak into the evening.
 *
 * EXIF's `DateTimeOriginal` is a wall-clock reading with NO timezone: the
 * string "2026:09:20 07:32:11" means 07:32 on whatever clock the camera was
 * set to. EXIF 2.31 added `OffsetTimeOriginal` to say which clock that was, and
 * newer phones write it. So:
 *
 *   - with an offset, the instant is known exactly
 *   - without one, the reading is treated as local time on THIS device, which
 *     is right whenever the photo was taken in the timezone the phone is in now
 *     — the ordinary case for a report filed in Taiwan about a photo taken in
 *     Taiwan, and the assumption this project can afford
 *
 * Deliberately separate from image.ts so it can be tested: image.ts needs
 * `document` and `createImageBitmap`, and a parser that decides what time a
 * record carries should not be reachable only through a canvas.
 */

/** Cameras with a dead battery report 1970, or 1980, or all zeroes. */
const EARLIEST = Date.UTC(1990, 0, 1);

/**
 * A phone whose clock is a few minutes fast should not have its photo thrown
 * away. Hours fast is a broken clock; five minutes is drift.
 */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/** "2026:09:20 07:32:11", the only shape EXIF writes. Sub-second parts ignored. */
const EXIF_DATETIME = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

/** "+08:00", "-05:30", "Z". EXIF writes the first two; "Z" is tolerated. */
const EXIF_OFFSET = /^(?:(Z)|([+-])(\d{2}):(\d{2}))$/;

/** Minutes east of UTC, or null when the string is absent or not an offset. */
function offsetMinutes(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const m = EXIF_OFFSET.exec(raw.trim());
  if (!m) return null;
  if (m[1]) return 0;
  const minutes = Number(m[3]) * 60 + Number(m[4]);
  // ±14:00 is the widest real offset (Line Islands). Anything past it is a
  // corrupt tag, and a corrupt tag should not shift a record by a day.
  if (minutes > 14 * 60) return null;
  return m[2] === "-" ? -minutes : minutes;
}

/**
 * The instant a photo was taken, or null when EXIF does not say or cannot be
 * believed.
 *
 * `now` is a parameter rather than a call to the clock so the boundary cases
 * are testable and so this stays pure.
 */
export function parseExifDateTime(
  raw: string | null | undefined,
  offset: string | null | undefined,
  now: Date,
): Date | null {
  if (typeof raw !== "string") return null;
  const m = EXIF_DATETIME.exec(raw.trim());
  if (!m) return null;

  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
  // "0000:00:00 00:00:00" is what a camera writes when it has never been set,
  // and it parses as a real date in every lenient parser.
  if (!y || !mo || !d) return null;

  const mins = offsetMinutes(offset);
  const when =
    mins === null
      ? // No offset: the reading is a local wall clock. `new Date(y, mo-1, …)`
        // is the only constructor that means "this reading, on this device's
        // clock", and it handles the device's own DST rules for that date.
        new Date(y, mo - 1, d, h, mi, s)
      : new Date(Date.UTC(y, mo - 1, d, h, mi, s) - mins * 60_000);

  const t = when.getTime();
  if (!Number.isFinite(t)) return null;

  // Round-trip check: a reading of "2026:02:30" is not a date, but the local
  // constructor rolls it into March rather than refusing. Comparing the fields
  // back is what catches that, and only for the local branch — the UTC branch
  // is checked the same way below.
  if (mins === null) {
    if (
      when.getFullYear() !== y ||
      when.getMonth() !== mo - 1 ||
      when.getDate() !== d ||
      when.getHours() !== h ||
      when.getMinutes() !== mi
    )
      return null;
  } else {
    const back = new Date(t + mins * 60_000);
    if (
      back.getUTCFullYear() !== y ||
      back.getUTCMonth() !== mo - 1 ||
      back.getUTCDate() !== d ||
      back.getUTCHours() !== h ||
      back.getUTCMinutes() !== mi
    )
      return null;
  }

  if (t < EARLIEST) return null;
  if (t > now.getTime() + FUTURE_SKEW_MS) return null;
  return when;
}
