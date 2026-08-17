/**
 * The map's own shell, held while its statistics load.
 *
 * Painted in the map's dark ground rather than the page's paper. The rest of the
 * site is light, so a shared skeleton would flash white and then go black the
 * moment the real map mounted — worse than showing nothing.
 *
 * This covers the server round trip only. MapLibre's own boot and first tiles
 * come after, and are handled inside the map component.
 */
export default function Loading() {
  return (
    <main aria-busy="true" className="flex h-[100dvh] flex-col bg-bark-950">
      <span className="sr-only">Loading the map…</span>
      <div className="flex shrink-0 items-center justify-between gap-6 border-b border-parchment-200/10 bg-paper-50 px-4 py-2.5">
        <div className="h-8 w-40 animate-pulse rounded bg-ink-900/10" />
        <div className="hidden gap-4 sm:flex">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-8 w-16 animate-pulse rounded bg-ink-900/10"
            />
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-bark-950" />
    </main>
  );
}
