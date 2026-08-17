/**
 * A path prefix this app can be mounted under. Currently always empty.
 *
 * HabitatWatch is served from the root of its own subdomain, so `withBase` is an
 * identity function today and every call site behaves exactly as it did before.
 * It is kept because the alternative — deleting it and rediscovering the same
 * things if the projects ever move to one domain — is worse than one inert
 * indirection, and because the list below is the useful part regardless.
 *
 * Next applies `basePath` automatically to `<Link>` and router navigation. It
 * does NOT apply it to `next/image` — the docs are explicit that you must
 * prefix `src` yourself — nor to anything else written by hand: `fetch()` to an
 * API route, `navigator.serviceWorker.register()`, a dynamic `import()` of a
 * file in `public/`, or paths inside the web manifest.
 *
 * The service worker is the one that bites. Its scope IS its path: registered
 * from the root it cannot control pages under a prefix, so offline report
 * queuing would stop working with nothing logging an error.
 *
 * Two things would also have to change outside this file before a prefix could
 * be switched on: the cron job's URL, since API routes move with it, and the
 * Turnstile hostname allowlist, since it validates on the domain serving the
 * widget. Both fail silently.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a root-relative path with the base path. */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}
