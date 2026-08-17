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
      <div className="mt-5 grid gap-1.5 sm:grid-cols-2 sm:gap-x-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Bar key={i} className="h-[68px] rounded-lg" />
        ))}
      </div>
    </Page>
  );
}
