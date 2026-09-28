import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { LATE, fetchUntil, settledBy } from "./proxy";

/**
 * How long a page waits to learn who is signed in before rendering as if
 * nobody were.
 *
 * The answer is one round trip to Supabase, normally tens of milliseconds, so
 * this only runs out when Supabase is down or failing. What it replaces, on
 * every page a signed-in person opened during an outage: however long a
 * request with no answer is left hanging, or, with a session due for renewal,
 * up to 30 seconds of supabase-js retrying the refresh that the proxy had
 * already given up on at its own 5-second deadline. Shorter than the proxy's,
 * so the proxy and the header's question together cost a page eight seconds
 * at most.
 */
const PAGE_AUTH_DEADLINE_MS = 3000;

/**
 * Server client bound to the request's cookies, for reading the current session.
 *
 * With a `deadline`, every request it makes stops there (see `fetchUntil`) and
 * nothing it writes after it is kept. Without one it waits as long as Supabase
 * takes, which is right where the answer matters more than the wait: spending
 * the one-time code in /auth/callback, signing out, filing a report.
 */
export async function serverSupabase({ deadline }: { deadline?: AbortSignal } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not set");

  const store = await cookies();
  return createServerClient(url, key, {
    ...(deadline && { global: { fetch: fetchUntil(deadline) } }),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Past the deadline, the only write left is supabase-js clearing the
        // session it gave up renewing. In a Server Action that would stick,
        // and sign someone out because Supabase was slow.
        if (deadline?.aborted) return;
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Ignoring is correct only because proxy.ts renews an expiring
          // session before the render starts (lib/supabase/proxy.ts), so a
          // Server Component normally finds nothing to write. From the first
          // commit until this one the comment claimed a middleware did that,
          // and none did.
        }
      },
    },
  });
}

/** Whether Supabase auth is configured at all on this deployment. */
function authConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * The signed-in user's id, or null for an anonymous visitor.
 *
 * `SiteHeader` calls this on every page to decide whether to show "my reports",
 * so it runs during the prerender of every static page. When Supabase is not
 * configured, `serverSupabase()` throws — and one throw inside a prerender ends
 * the whole build, not just that page:
 *
 *     Error occurred prerendering page "/zh-TW"
 *     Error: NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not set
 *     Export encountered an error on /[locale]/page: /zh-TW, exiting the build.
 *
 * That is why **every preview deployment on this project has failed**, for weeks,
 * on every branch including documentation-only ones. Vercel's Preview
 * environment has no `NEXT_PUBLIC_SUPABASE_*` values, so the build reliably died
 * at around page 650 of 862 and no pull request has ever had a working preview.
 *
 * Outside production, "not configured" is answered with `null` — and that is the
 * correct answer rather than a fudge. With no Supabase project to ask, there is
 * no session, so nobody is signed in, and a signed-out header is exactly what
 * should render.
 *
 * **Production still throws**, by falling through to `serverSupabase()`. A
 * production build missing these is a real misconfiguration, and the failure
 * everyone notices is better than a site that silently renders signed-out to
 * people who are signed in. Same rule, same variable, as the design lab gate and
 * the Turnstile key check.
 *
 * Note the limit: this makes previews *build*, not authenticate. The browser
 * client needs the same two values, so on a preview `/login` cannot complete and
 * `/me` and `/admin` show their signed-out branches. Previews are for reviewing
 * what a page looks like; giving them credentials is a separate decision, and it
 * would point them at the production database.
 */
export async function currentUserId(): Promise<string | null> {
  if (!authConfigured() && process.env.VERCEL_ENV !== "production") return null;
  const deadline = AbortSignal.timeout(PAGE_AUTH_DEADLINE_MS);
  return (await userBy(await serverSupabase({ deadline }), deadline))?.id ?? null;
}

/**
 * Who Supabase says is signed in, or null — including when it has not said so
 * by the deadline. Null is the safe reading everywhere this is used: the
 * header shows "Sign in", /me and /admin show their signed-out branches, and
 * the moderation actions refuse.
 */
async function userBy(
  supabase: Awaited<ReturnType<typeof serverSupabase>>,
  deadline: AbortSignal,
) {
  const answer = await settledBy(supabase.auth.getUser(), deadline);
  return answer === LATE ? null : (answer.data?.user ?? null);
}

/**
 * The signed-in person's id and email, for /me, which says whose account it is.
 *
 * Worth saying there: a student may have a school address and a personal one,
 * and they are separate accounts with separate report histories. Same guard as
 * `currentUserId`, for the same reason.
 */
export async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  if (!authConfigured() && process.env.VERCEL_ENV !== "production") return null;
  const deadline = AbortSignal.timeout(PAGE_AUTH_DEADLINE_MS);
  const user = await userBy(await serverSupabase({ deadline }), deadline);
  return user ? { id: user.id, email: user.email ?? null } : null;
}
