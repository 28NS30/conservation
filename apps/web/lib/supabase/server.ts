import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server client bound to the request's cookies, for reading the current session. */
export async function serverSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not set");

  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh happens in middleware; ignoring here is correct.
        }
      },
    },
  });
}

/** The signed-in user's id, or null for an anonymous visitor. */
export async function currentUserId(): Promise<string | null> {
  const { data } = await (await serverSupabase()).auth.getUser();
  return data?.user?.id ?? null;
}
