import type { Instrumentation } from "next";

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
 * Node only: the database client is a Node module, and nothing in this app runs
 * on the edge runtime. Not during `next build` either: its prerender errors
 * are the build log's to report, and its workers already use most of the
 * database's connections (see the note on `max` in lib/db.ts).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const { recordRequestError } = await import("./lib/appErrors");
    await recordRequestError(err, context);
  } catch {
    /* recording an error must never become one */
  }
};
