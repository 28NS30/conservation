import { sql } from "@/lib/db";
import { APP_ERROR_UPSERT, APP_ERRORS_PER_HOUR, requestErrorKey } from "@/lib/monitoring";

/**
 * Count a server error in `app_errors` (0036): one row per route pattern,
 * digest and hour, its count going up by one.
 *
 * Called from instrumentation.ts onRequestError, so for every server error
 * the site has, and therefore written to be cheap and to fail quietly:
 *
 *   - It never throws. A failure to count an error must not become a second
 *     error, and onRequestError runs while Next.js is already answering one.
 *   - It records only what lib/monitoring.ts requestErrorKey() keeps: the route
 *     pattern and the digest. The request (its address, headers and body) is
 *     never read here, so nothing about who asked can reach the table.
 *   - It is capped twice. The table takes at most APP_ERRORS_PER_HOUR new rows
 *     an hour (an existing row's count still goes up), and each server
 *     instance writes at most PER_MINUTE times a minute and stops for a minute
 *     after a write fails. An outage that fails every request is then a few
 *     writes a minute rather than one per request, competing with the
 *     requests for the same eight connections. The count is therefore a floor
 *     in a storm, which is enough to say that one happened, and where.
 *
 * No `server-only` here, unlike the other server modules: instrumentation is
 * not compiled as a server component, and that package throws when imported
 * outside one.
 */
const PER_MINUTE = 30;
const PAUSE_MS = 60_000;

let windowStart = 0;
let writes = 0;
let pausedUntil = 0;

export async function recordRequestError(err: unknown, context: unknown): Promise<void> {
  try {
    const now = Date.now();
    if (now < pausedUntil) return;
    if (now - windowStart >= 60_000) {
      windowStart = now;
      writes = 0;
    }
    if (++writes > PER_MINUTE) return;

    const { route, digest } = requestErrorKey(err, context);
    await sql.begin(async (tx) => {
      await tx`set local statement_timeout = '2s'`;
      await tx.unsafe(APP_ERROR_UPSERT, [route, digest, APP_ERRORS_PER_HOUR]);
    });
  } catch (e) {
    pausedUntil = Date.now() + PAUSE_MS;
    try {
      console.error("[app-errors] not recorded:", (e as Error)?.message);
    } catch {
      /* nothing left to do */
    }
  }
}
