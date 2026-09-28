"use server";

import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { authCookieName } from "@/lib/supabase/proxy";

/**
 * Sign out on this device, then go home.
 *
 * `scope: "local"`: signing out of a shared school computer should not also
 * sign you out of your phone. Supabase's default is every device at once.
 *
 * If Supabase cannot be reached, its client keeps the session rather than
 * clearing it — and a sign-out button that leaves you signed in is the one
 * outcome it must never have. So the session cookies are then removed here
 * directly: the refresh token stays valid on Supabase's side until it expires,
 * but this browser no longer holds it.
 */
export async function signOut() {
  const locale = await getLocale();
  const supabase = await serverSupabase();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    const name = authCookieName(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const store = await cookies();
    if (name)
      for (const c of store.getAll())
        if (c.name === name || c.name.startsWith(`${name}.`))
          store.delete({ name: c.name, path: "/" });
  }
  redirect({ href: "/", locale });
}
