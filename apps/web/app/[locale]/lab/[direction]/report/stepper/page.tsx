import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import StepperFlow from "@/components/lab/report/StepperFlow";
import { getLabCopy } from "@/lib/lab/copy";
import { isLabDirection, labPath } from "@/lib/lab/directions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { title: getLabCopy(locale).lab.pageReportStepper };
}

/**
 * The recommended flow, as a static proof.
 *
 * It renders no site header, no footer and no tab bar: the flow owns the
 * screen. Everything interactive is in one client component, because every
 * question in this form depends on the answer to an earlier one and splitting
 * that across server boundaries would buy nothing but a round trip.
 *
 * `searchParams` is read here rather than with `useSearchParams` so the receipt
 * is decided before the first paint — a forced receipt that arrived a frame
 * late would flash the photo screen at somebody who asked to see an ending.
 * It makes this page dynamic, which for a prototype behind a gate costs
 * nothing.
 */
export default async function LabReportStepperPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; direction: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale, direction } = await params;
  setRequestLocale(locale);
  if (!isLabDirection(direction)) return null;

  const receipt = (await searchParams).receipt;

  return (
    <StepperFlow
      copy={getLabCopy(locale)}
      direction={direction}
      flowPath={labPath(direction, "/report/stepper")}
      receiptParam={typeof receipt === "string" ? receipt : undefined}
    />
  );
}
