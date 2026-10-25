/**
 * A server error on purpose, in a test build only (NEXT_PUBLIC_E2E=1, which is
 * inlined when the app is built and is never set for a deployed one, so this
 * answers 404 there).
 *
 * test/monitoring.test.mjs asks for it and then looks for its row in
 * app_errors: the only way to show that an error in the running server goes
 * through instrumentation.ts and is counted, rather than that the pieces each
 * work when called by hand.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NEXT_PUBLIC_E2E !== "1") return new Response("Not Found", { status: 404 });
  throw new Error("a deliberate server error, for test/monitoring.test.mjs");
}
