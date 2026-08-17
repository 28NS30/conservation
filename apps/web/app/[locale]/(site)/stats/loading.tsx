import { Bar, HeaderSkeleton, Page } from "@/components/site/Skeleton";

/** Mirrors the metric row and the two-column panel grid. */
export default function Loading() {
  return (
    <Page>
      <HeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bar key={i} className="h-[76px] rounded-lg" />
        ))}
      </div>
      <div className="mt-4 grid items-start gap-3 lg:grid-cols-2">
        <Bar className="h-56 rounded-xl" />
        <Bar className="h-56 rounded-xl" />
        <Bar className="h-[520px] rounded-xl" />
        <Bar className="h-80 rounded-xl" />
      </div>
    </Page>
  );
}
