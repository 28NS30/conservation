import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client.
 *
 * This module is deliberately the *only* Supabase entry point reachable from the
 * client bundle, and it holds nothing but the publishable anon key. Server
 * concerns — `next/headers`, the service-role key — live in ./server and
 * ./service, both of which import `server-only` so a stray client import becomes
 * a build error rather than a leaked credential.
 *
 * Used for auth (magic link) and for uploading to pre-signed Storage URLs.
 * Never for data access: reads go through our own route handlers.
 */
export function browserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not set");
  return createBrowserClient(url, key);
}

export const PHOTO_BUCKET = "report-photos";
