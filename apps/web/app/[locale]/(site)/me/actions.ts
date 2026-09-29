"use server";

import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { currentUserId, serverSupabase } from "@/lib/supabase/server";
import { serviceSupabase } from "@/lib/supabase/service";
import { sql } from "@/lib/db";
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

export type DeleteAccountState = { error: "signIn" | "confirm" | "failed" } | null;

/**
 * Delete my account: the sign-in, the email address, and every link from a
 * report to the person who sent it.
 *
 * Taiwan's Personal Data Protection Act lets a person have their data
 * deleted, and /privacy asked them to write in for it. Here they can do it
 * themselves, from the page that lists what they sent.
 *
 * What goes: the profile (and with it the forum profile, whose posts stay as
 * "deleted member", migration 0019), the Supabase account, and on each of
 * their reports the reporter and the optional contact address. What stays:
 * the reports themselves, which were given under a licence for others to use
 * and may already be in someone's copy of the data; they keep the credit name
 * the reporter chose for them, since that is how the licence asks to be
 * credited.
 *
 * The database half runs first, in one transaction, and says it all
 * explicitly even though deleting the Supabase user cascades most of it:
 * CI's plain Postgres has no auth schema, and a half that relies on a cascade
 * nobody can see is a half nobody tests. If the Supabase half then fails, the
 * person is told and can press again; nothing that was removed needs undoing.
 */
export async function deleteMyAccount(
  _prev: DeleteAccountState,
  form: FormData,
): Promise<DeleteAccountState> {
  const userId = await currentUserId();
  if (!userId) return { error: "signIn" };
  if (form.get("confirmDelete") !== "on") return { error: "confirm" };

  await sql.begin(async (tx) => {
    await tx`
      update reports
         set reporter_id = null, contact_email = null
       where reporter_id = ${userId}::uuid`;
    await tx`delete from profiles where id = ${userId}::uuid`;
  });

  const { error } = await serviceSupabase().auth.admin.deleteUser(userId);
  if (error) {
    console.error("[me] delete account:", error.message);
    return { error: "failed" };
  }

  // The account is gone, so Supabase has no session to end; the cookies that
  // held it are removed here, as signOut does when Supabase cannot answer.
  const name = authCookieName(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const store = await cookies();
  if (name)
    for (const c of store.getAll())
      if (c.name === name || c.name.startsWith(`${name}.`))
        store.delete({ name: c.name, path: "/" });

  redirect({ href: "/", locale: await getLocale() });
  return null;
}
