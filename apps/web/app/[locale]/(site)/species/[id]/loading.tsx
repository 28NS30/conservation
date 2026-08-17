import { Bar, Page } from "@/components/site/Skeleton";

/** Mirrors the species header, the map panel and the seasonality chart. */
export default function Loading() {
  return (
    <Page width="max-w-3xl">
      <Bar className="h-8 w-56" />
      <Bar className="mt-3 h-5 w-72" />
      <div className="mt-3 flex gap-1.5">
        <Bar className="h-5 w-16 rounded" />
        <Bar className="h-5 w-20 rounded" />
      </div>
      <Bar className="mt-8 h-5 w-32" />
      <Bar className="mt-3 h-64 rounded-lg sm:h-80" />
      <Bar className="mt-8 h-40 rounded-lg" />
    </Page>
  );
}
