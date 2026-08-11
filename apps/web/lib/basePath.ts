/**
 * Where this app is mounted under biowatchintl.org.
 *
 * Next applies `basePath` automatically to `<Link>` and router navigation. It
 * does NOT apply it to `next/image` — the docs are explicit that you must
 * prefix `src` yourself — nor to anything else you write by hand: `fetch()`
 * to an API route, `navigator.serviceWorker.register()`, a dynamic `import()` of
 * a file in `public/`, or paths inside the web manifest. Those are the ones that
 * need `withBase`, and each is a silent failure if missed — a 404 the app reads
 * as "the server said no" rather than "I asked the wrong URL".
 *
 * Empty string deploys this app at a domain root again, which is what the tests
 * and the local dev server use.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a root-relative path with the base path. */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}
