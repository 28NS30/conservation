import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing, type Locale } from "@/i18n/routing";
import LabStrip from "@/components/lab/chrome/LabStrip";
import { getLabCopy } from "@/lib/lab/copy";
import { labEnabled } from "@/lib/lab/gate";

import "./themes/base.css";
import "./themes/roundel.css";
import "./themes/journal.css";

/**
 * The lab's outer shell: the gate, the themes, and the compare strip.
 *
 * Two things happen here and nowhere else.
 *
 * The GATE. `labEnabled()` is checked before anything renders, and a false
 * answer is a 404 — not a redirect and not an empty page, because the honest
 * answer to "does /lab exist on production" is that it does not. Note that
 * there must be no `loading.tsx` anywhere beneath this: under one, a route that
 * calls `notFound()` answers 200 with a skeleton instead of 404, which is
 * written up in `components/site/Skeleton.tsx` and would quietly unlock the lab.
 *
 * NOINDEX. Even gated, the production flag will one day be on so the owner can
 * open it on a phone, and at that moment a crawler can reach four prototype
 * homepages of a site with one real homepage. Metadata merges shallowly and the
 * last segment to define a field wins, so no page under here may set `robots`.
 *
 * The theme files are imported once, here, and are scoped to `[data-lab]` and
 * `[data-direction]`, so importing them cannot reach a live page.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function LabLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  if (!labEnabled()) notFound();

  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <div
      data-lab=""
      data-surface="paper"
      className="flex min-h-[100dvh] flex-col bg-(--ground) text-(--fg)"
    >
      <LabStrip copy={getLabCopy(locale)} locale={locale as Locale} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
