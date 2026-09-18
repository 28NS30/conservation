import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import PhotoFirstFlow from "@/components/lab/report/PhotoFirstFlow";
import { getLabCopy } from "@/lib/lab/copy";
import {
  isLabDirection,
  labPath,
  labRouteExists,
} from "@/lib/lab/directions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { title: getLabCopy(locale).lab.pageReportPhotoFirst };
}

/**
 * The runner-up flow, beside the recommendation and built from the same parts.
 *
 * A second proof is worth about half a day precisely because it shares
 * everything below the surface with the stepper. If the owner picks this one it
 * is because sections piling up on one page suits them better than screens that
 * swap, and not because one of the two happened to be the one that got the
 * attention.
 */
export default async function LabReportPhotoFirstPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; direction: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale, direction } = await params;
  setRequestLocale(locale);
  // `notFound()`, not `return null`: a blank 200 for a route that was never
  // built in this direction is indistinguishable from a broken page.
  if (!isLabDirection(direction)) notFound();
  if (!labRouteExists("/report/photo-first", direction)) notFound();

  const receipt = (await searchParams).receipt;

  return (
    <PhotoFirstFlow
      copy={getLabCopy(locale)}
      direction={direction}
      flowPath={labPath(direction, "/report/photo-first")}
      receiptParam={typeof receipt === "string" ? receipt : undefined}
    />
  );
}
