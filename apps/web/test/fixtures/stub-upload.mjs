/**
 * lib/report/upload.ts without Supabase, for running lib/offline in node. A
 * photograph "uploads" at once and goes nowhere: what the tests are about is
 * what the queue does around it.
 */
export const UPLOAD_TIMEOUT_MS = 90_000;

export async function uploadPhoto() {}
