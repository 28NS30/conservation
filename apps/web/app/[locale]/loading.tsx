/**
 * The home page, held while its counts and top species load.
 *
 * The hero is a dark full-bleed map with a floating panel, so this reserves the
 * same shape — a light placeholder would flash against the map behind it.
 */
export default function Loading() {
  return (
    <main aria-busy="true" className="bg-paper-50">
      <span className="sr-only">Loading…</span>
      <section className="relative h-[100dvh] min-h-[600px] w-full overflow-hidden bg-bark-950">
        <div className="absolute inset-0 flex items-center">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="w-full max-w-[400px] rounded-3xl border border-parchment-200/15 bg-bark-900/80 p-7 sm:p-8">
              <div className="mx-auto size-[148px] animate-pulse rounded-full bg-parchment-50/10" />
              <div className="mx-auto mt-6 h-3 w-32 animate-pulse rounded bg-parchment-50/10" />
              <div className="mx-auto mt-4 h-5 w-full animate-pulse rounded bg-parchment-50/10" />
              <div className="mt-7 space-y-2.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-11 animate-pulse rounded-xl bg-parchment-50/10"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
