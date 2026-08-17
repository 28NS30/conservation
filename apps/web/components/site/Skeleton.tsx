/**
 * Placeholder shapes for the loading.tsx files.
 *
 * These deliberately mirror the real layout rather than showing a spinner. A
 * spinner says "something is happening"; a skeleton in the right shape says
 * "the thing you asked for is arriving, and it will look like this" — the page
 * does not jump when the content lands, because the space was already the right
 * size.
 *
 * Kept dependency-free and server-rendered. A loading state that needs
 * JavaScript to appear is no use on the connection it exists for.
 *
 * WATCH THE BOUNDARY. A loading.tsx makes its whole segment tree stream, so the
 * 200 and its headers are sent before the page has decided anything. Any route
 * beneath it that calls redirect() or notFound() then answers 200 instead —
 * /species/[id] returned 200 for a species that does not exist, and 200 rather
 * than a 307 for a non-canonical slug. That is a correctness and an SEO problem,
 * not a cosmetic one, and no test of the list pages would have caught it.
 *
 * It is the boundary's POSITION that matters, not its contents: species/
 * loading.tsx covered species/[id] because [id] is a child segment. The list
 * pages therefore sit in (directory) and (list) route groups — invisible in the
 * URL — so each skeleton wraps only its own page.
 */
export function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-ink-900/10 ${className}`} />;
}

/** The page title block every inner page opens with. See PageHeader. */
export function HeaderSkeleton({ lede = true }: { lede?: boolean }) {
  return (
    <div className="mb-8">
      <Bar className="h-9 w-64" />
      {lede && <Bar className="mt-4 h-4 w-full max-w-xl" />}
    </div>
  );
}

/**
 * Wraps a skeleton in the same measure the real page uses, so the content does
 * not shift sideways when it arrives.
 */
export function Page({
  children,
  width = "max-w-5xl",
}: {
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className={`mx-auto w-full ${width} px-6 pb-24 pt-12`}
    >
      <span className="sr-only">Loading…</span>
      {children}
    </main>
  );
}
