import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { sessionCookieOptions, withSessionLifetime } from "./cookieOptions";

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
 *
 * The cookie is read and written here rather than left to the library, which
 * does the same with `document.cookie`, only so that the lifetime can be
 * capped as the server caps it (./cookieOptions.ts). Secure follows the page's
 * scheme: always in production, never on a laptop's http://localhost.
 */
export function browserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not set");
  return createBrowserClient(url, key, {
    cookieOptions: sessionCookieOptions(window.location.protocol === "https:"),
    cookies: {
      getAll: () => parseCookieHeader(document.cookie),
      setAll: (list) => {
        for (const { name, value, options } of list)
          document.cookie = serializeCookieHeader(name, value, withSessionLifetime(options));
      },
    },
  });
}

export const PHOTO_BUCKET = "report-photos";
