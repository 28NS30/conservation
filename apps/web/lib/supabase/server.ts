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
  const { data } = await (await serverSupabase()).auth.getUser();
  return data?.user?.id ?? null;
}
