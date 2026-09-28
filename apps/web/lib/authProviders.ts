/**
 * Whether "Continue with Google" can work on this deployment, asked of Supabase
 * at request time.
 *
 * The button is only honest if the provider is switched on in the Supabase
 * project, and that is a dashboard setting the code cannot see. Hard-coding it
 * either way is wrong somewhere: shown while disabled, it sends people to a
 * Supabase error page ("Unsupported provider: provider is not enabled"); hidden
 * until a deploy, it waits on an engineer after the owner has already turned
 * Google on. So the login page asks the project's public settings endpoint,
 * which reports each provider as true or false.
 *
 * Every doubt resolves to "no button". An unreachable Supabase, a slow one, a
 * reply in a shape we do not recognise, a deployment with no Supabase at all:
 * each hides the button and leaves the email code, which works without it.
 *
 * Not `server-only`, deliberately: nothing here is secret (the URL and the
 * anon key are both public), and the unit test imports it directly. Only the
 * login page's server render calls it.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ProviderCheckOptions = {
  url?: string;
  anonKey?: string;
  fetch?: Fetch;
  now?: () => number;
  /** How long a definite answer is reused. */
  ttlMs?: number;
  /**
   * How long a failure is reused. Shorter, so a blip does not hide the button
   * for long — but not zero, or an outage would make every sign-in page wait
   * out the timeout.
   */
  failureTtlMs?: number;
  timeoutMs?: number;
};

/** True only for the exact shape Supabase answers with: `external.google === true`. */
export function googleEnabledIn(settings: unknown): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const external = (settings as { external?: unknown }).external;
  if (typeof external !== "object" || external === null) return false;
  return (external as { google?: unknown }).google === true;
}

/**
 * A cached "is Google on?" check. A factory so the test can give it a fake
 * fetch and clock; the app uses the one instance exported below.
 *
 * The cache lives in module memory, one per server instance. That is enough:
 * the setting changes perhaps once in the project's life, and five minutes of
 * staleness after the owner flips it costs nothing.
 */
export function createGoogleCheck(options: ProviderCheckOptions = {}) {
  const {
    url,
    anonKey,
    fetch: doFetch = globalThis.fetch,
    now = Date.now,
    ttlMs = 5 * 60_000,
    failureTtlMs = 30_000,
    timeoutMs = 1500,
  } = options;

  let cached: { value: boolean; until: number } | null = null;
  // Concurrent page renders share one request rather than each starting their own.
  let pending: Promise<boolean> | null = null;

  async function ask(): Promise<{ value: boolean; ok: boolean }> {
    if (!url) return { value: false, ok: true };
    try {
      const res = await doFetch(`${url.replace(/\/+$/, "")}/auth/v1/settings`, {
        headers: anonKey ? { apikey: anonKey } : {},
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { value: false, ok: false };
      return { value: googleEnabledIn(await res.json()), ok: true };
    } catch {
      return { value: false, ok: false };
    }
  }

  return async function googleSignInEnabled(): Promise<boolean> {
    const t = now();
    if (cached && t < cached.until) return cached.value;
    pending ??= ask()
      .then(({ value, ok }) => {
        cached = { value, until: now() + (ok ? ttlMs : failureTtlMs) };
        return value;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

export const googleSignInEnabled = createGoogleCheck({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
