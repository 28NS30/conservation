"use client";

import { Link, usePathname } from "@/i18n/navigation";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import type { LabCopy } from "@/lib/lab/copy";
import {
  LAB_DIRECTION_LABELS,
  LAB_ROUTES,
  isLabDirection,
  labPath,
  otherDirection,
} from "@/lib/lab/directions";
import type { Locale } from "@/i18n/routing";

/**
 * The comparison strip: which look is on screen, and two ways off it.
 *
 * The owner will be flipping between three versions of the same page — this
 * direction, the other one, and what is live today — on a phone, outdoors,
 * probably while someone waits. Making them type a URL or use the back button
 * three times is how a comparison turns into an impression.
 *
 * DELIBERATELY UNTHEMED. It takes its colours from `.lab-strip`, which belongs
 * to neither direction, because a strip that picked up the theme would be read
 * as part of the design being judged. It also carries the prototype warning:
 * the words on these pages are not final and nobody should be asked to react to
 * them as if they were.
 *
 * A client component for one reason: it needs the current path to work out
 * what the same page looks like in the other direction, and which live route
 * this is a redesign of.
 *
 * A `<nav>` rather than a `<div>`, because it is four links out of this page
 * and because content outside every landmark is content a screen-reader user
 * reaches only by walking the whole document: axe's `region` rule failed every
 * lab route on exactly this, six nodes at a time.
 */
export default function LabStrip({
  copy,
  locale,
}: {
  copy: LabCopy;
  locale: Locale;
}) {
  const pathname = usePathname();
  const match = /^\/lab\/([^/]+)(\/.*)?$/.exec(pathname);
  const direction = match && isLabDirection(match[1]) ? match[1] : null;
  const sub = match?.[2] ?? "";

  // Only home exists in both directions; everything else is Roundel alone, so
  // the switch has to land somewhere real rather than on a 404.
  const other = direction ? otherDirection(direction) : null;
  const twin =
    other &&
    LAB_ROUTES.find(
      (route) =>
        route.sub === sub &&
        (route.directions as readonly string[]).includes(other),
    );
  const live = LAB_ROUTES.find((route) => route.sub === sub)?.live ?? "/";

  return (
    <nav className="lab-strip" aria-label={copy.lab.indexTitle}>
      <div className="mx-auto flex w-full max-w-(--container-page) flex-wrap items-center gap-x-6 gap-y-1 px-(--gutter) py-1">
        <span className="t-note py-2 opacity-80">{copy.lab.banner}</span>
        {direction ? (
          <>
            <span className="t-note py-2">
              {copy.lab.directionOnScreen}：
              {LAB_DIRECTION_LABELS[direction][locale]}
            </span>
            {other ? (
              <Link
                href={labPath(other, twin ? sub : "")}
                className="t-note inline-flex min-h-11 items-center underline underline-offset-4"
              >
                {copy.lab.switchTo} {LAB_DIRECTION_LABELS[other][locale]}
              </Link>
            ) : null}
          </>
        ) : null}
        <Link
          href={live}
          className="t-note inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {copy.lab.todaysPage}
        </Link>
        <Link
          href="/lab"
          className="t-note inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {copy.lab.indexTitle}
        </Link>
        <LanguageSwitcher className="t-note lab-lang ml-auto" />
      </div>
    </nav>
  );
}
