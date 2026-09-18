import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { LAB_DIRECTIONS, isLabDirection } from "@/lib/lab/directions";

/**
 * Puts a direction on the page, and admits no third one.
 *
 * `data-direction` is the entire mechanism: every semantic variable the
 * primitives read is defined under `[data-direction="roundel"]` or
 * `[data-direction="journal"]`, so this one attribute is what makes the same
 * components render as two different designs.
 *
 * `dynamicParams = false` with `generateStaticParams` means `/lab/anything-else`
 * is a 404 rather than a page rendered with no theme at all — which would not
 * crash, it would just quietly look like unstyled HTML and waste somebody's
 * afternoon. The explicit `isLabDirection` check is belt and braces for dev,
 * where the params are generated on navigation rather than at build.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return LAB_DIRECTIONS.map((direction) => ({ direction }));
}

export default async function LabDirectionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; direction: string }>;
}) {
  const { locale, direction } = await params;
  if (!isLabDirection(direction)) notFound();
  setRequestLocale(locale);

  return (
    <div
      data-direction={direction}
      data-surface="paper"
      className="flex min-h-full flex-col bg-(--ground) text-(--fg)"
    >
      {children}
    </div>
  );
}
