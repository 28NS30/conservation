import type { Instrumentation } from "next";
import { platformWaitUntil } from "./lib/monitoring";

/**
 * Count every server error the site has, in `app_errors`, so a page that
 * fails for one kind of record leaves something behind once Vercel's hour of
 * logs has gone. What is kept, and what never is, is in lib/appErrors.ts: the
 * route pattern, the digest and the hour, and never the request, which this
 * function is handed and deliberately does not read.
 *
 * It cannot throw. Next.js would log the throw and carry on, but it would do
 * so in the middle of answering the request that already failed, and an error
 * handler that adds errors is the wrong way round.
 *
 * Making sure the write finishes. Next.js awaits this for an error in a route
 * handler or a server action, so those are written before the response goes.
 * For an error while rendering a page it does not: React calls it from its
 * error callback and ignores the promise, and on Vercel the function may be
 * frozen once the response is sent, with the write still in flight. So the
 * write is also handed to the platform's `waitUntil` (lib/monitoring.ts
 * platformWaitUntil), which keeps the invocation alive until it ends. Where
 * no platform offers one, the write is only awaited, as before: on `next
 * start` the process outlives the response anyway. Whether Vercel keeps a
 * render error's write this way has not been seen in production yet
 * (docs/production-state.md); until it has, a page's error may be counted
 * less often than it happens, and a route's or an action's is not.
 *
 * Node only: the database client is a Node module, and nothing in this app runs
 * on the edge runtime. Not during `next build` either: its prerender errors
 * are the build log's to report, and its workers already use most of the
 * database's connections (see the note on `max` in lib/db.ts).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    // Looked up first, while this request's context is the current one.
    const waitUntil = platformWaitUntil();
    const write = import("./lib/appErrors")
      .then(({ recordRequestError }) => recordRequestError(err, context))
      .catch(() => {});
    waitUntil?.(write);
    await write;
  } catch {
    /* recording an error must never become one */
  }
};
