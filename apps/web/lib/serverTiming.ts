/**
 * Where a server render's time went, as Server-Timing marks.
 *
 * `time(name, work)` records how long `work` took; `toString()` gives the
 * marks in Server-Timing's own syntax, "record;dur=12.3, photos;dur=80.1",
 * with the whole render last as `total`. Reads that run at once overlap, so
 * the marks need not add up to the total; the longest of them is what the
 * page waited for.
 *
 * Logged rather than sent as the header: a Server Component cannot set a
 * response header in this version of Next, and the proxy, which can, has
 * finished before the page begins. `logIfSlow` writes one line, and only for
 * a render slow enough to be worth reading, so the log is a list of slow
 * pages with the reason beside each.
 *
 * No imports, so the unit tests can load it directly.
 */
export function serverTiming() {
  const started = performance.now();
  const marks: string[] = [];
  const ms = (from: number) => (performance.now() - from).toFixed(1);
  return {
    async time<T>(name: string, work: Promise<T>): Promise<T> {
      const from = performance.now();
      try {
        return await work;
      } finally {
        marks.push(`${name};dur=${ms(from)}`);
      }
    },
    toString(): string {
      return [...marks, `total;dur=${ms(started)}`].join(", ");
    },
    elapsed(): number {
      return performance.now() - started;
    },
    /** One log line, `[what] server-timing: …`, if the render took `slowMs` or more. */
    logIfSlow(what: string, slowMs: number): void {
      if (this.elapsed() >= slowMs) console.warn(`[${what}] server-timing: ${this.toString()}`);
    },
  };
}
