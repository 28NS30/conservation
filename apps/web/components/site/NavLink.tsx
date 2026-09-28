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
  size = "normal",
}: {
  href: string;
  label: string;
  /** On the home hero the header floats over a dark map. */
  overlay?: boolean;
  /**
   * `large` is the forest bar on a desktop: the bold, condensed nav of the
   * team's brief. `normal` is the phone's second row. `compact` is that row on
   * the full-screen map only, where every pixel of chrome is a pixel of Taiwan
   * and map-chrome.spec caps the whole header at 89px.
   */
  size?: "compact" | "normal" | "large";
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
      // 14px text. The target is 40px tall inline and 36px on the phone's
      // wrapping row, where every extra pixel is multiplied by the number of
      // lines the row wraps to. It was 12px on 24px — WCAG 2.5.8's floor, met by
      // two Chinese glyphs only by accident of the writing system — and the team
      // asked for a bigger bar.
      //
      // Height only. A 40px minimum WIDTH was tried and measured: it forced each
      // two-glyph Chinese label to 40px, wrapped the phone row onto a third line,
      // and took the 320px header from 110px to 186px. The text supplies the
      // width; the box only needs to be tall enough to hit.
      className={`inline-flex min-w-6 items-center transition ${
        size === "large"
          ? "min-h-10 font-display text-[17px] font-semibold uppercase tracking-[0.06em]"
          : size === "compact"
            ? "min-h-6 text-xs"
            : "min-h-9 text-sm"
      } ${
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
