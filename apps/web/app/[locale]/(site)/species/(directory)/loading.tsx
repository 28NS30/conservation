import { Bar, HeaderSkeleton, Page } from "@/components/site/Skeleton";

/** Mirrors the two-column directory grid. */
export default function Loading() {
  return (
    <Page>
      <HeaderSkeleton />
      <Bar className="mt-6 h-10 w-full max-w-xl" />
      <div className="mt-4 flex flex-wrap gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bar key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      {/* As many rows as the page asks for, not a tidy dozen.
          The directory renders PER_PAGE = 80 (page.tsx), so twelve placeholders
          stood in for roughly 2,400px of list that was about to arrive — and
          when it did, everything below jumped. Measured on production, not
          inferred: CLS 0.0633 against a 0.05 budget, one shift at ~960ms, and
          the footer is the element that moves. A skeleton exists to hold the
          space the content will take; one that holds a seventh of it is worse
          than none, because it paints something stable and then moves it. */}
      <div className="mt-5 grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-x-4">
        {Array.from({ length: 80 }).map((_, i) => (
          <Bar key={i} className="h-[68px] rounded-lg" />
        ))}
      </div>
    </Page>
  );
}
