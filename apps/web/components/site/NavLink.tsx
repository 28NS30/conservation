"use client";

import { Link, usePathname } from "@/i18n/navigation";

/**
 * A header navigation link that knows whether you are already there.
 *
 * Nothing in the header said which page you were on. On a phone that matters
 * more than on a desktop: the nav is a single row of four short words with no
 * other landmark near it, and a screen reader heard four identical links on
 * every page of the site.
 *
 * `usePathname` from i18n/navigation returns the path WITHOUT the locale
 * prefix, so one comparison covers /map and /en/map. A descendant gets
 * `aria-current="true"` rather than `"page"` — /species/123 is not the species
 * directory, but it is inside it, and "true" is what ARIA has for that.
 *
 * Client-side, which costs nothing here: the language switcher beside it is
 * already a client component, so this ships in a bundle the header loads
 * anyway.
 */
export default function NavLink({
  href,
  label,
  overlay = false,
}: {
  href: string;
  label: string;
  /** On the home hero the header floats over a dark map. */
  overlay?: boolean;
}) {
  const pathname = usePathname();
  const current =
    pathname === href
      ? "page"
      : pathname.startsWith(`${href}/`)
        ? "true"
        : undefined;

  return (
    <Link
      href={href}
      aria-current={current}
      // min-h-6/min-w-6 is WCAG 2.5.8's floor. Two Chinese glyphs at this size
      // are exactly 24px wide and 12px tall, which is a fingertip target only by
      // accident of the writing system.
      className={`inline-flex min-h-6 min-w-6 items-center text-xs transition ${
        current
          ? overlay
            ? "text-parchment-50 underline underline-offset-4"
            : "text-ink-900 underline underline-offset-4"
          : overlay
            ? "text-parchment-200 hover:text-parchment-50"
            : "text-ink-600 hover:text-ink-900"
      }`}
    >
      {label}
    </Link>
  );
}
