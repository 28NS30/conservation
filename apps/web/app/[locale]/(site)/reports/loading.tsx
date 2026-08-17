import { Bar, HeaderSkeleton, Page } from "@/components/site/Skeleton";

/** Mirrors the filter chips and the table. */
export default function Loading() {
  return (
    <Page width="max-w-4xl">
      <HeaderSkeleton />
      <div className="mt-4 flex flex-wrap gap-1.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <Bar key={i} className="h-7 w-24 rounded-full" />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        <Bar className="h-5 w-full" />
        {Array.from({ length: 14 }).map((_, i) => (
          <Bar key={i} className="h-8 w-full" />
        ))}
      </div>
    </Page>
  );
}
