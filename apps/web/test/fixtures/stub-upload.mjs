/**
 * lib/report/upload.ts without Supabase, for running lib/offline in node. The
 * reports these tests queue carry no photographs, so it is never called.
 */
export const UPLOAD_TIMEOUT_MS = 90_000;

export async function uploadPhoto() {
  throw new Error("the tests that load this queue no photographs");
}
