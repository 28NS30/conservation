"use client";

import { useEffect, useRef } from "react";
import { Link, usePathname } from "@/i18n/navigation";

export type ReportChoice = { href: string; label: string; hint: string };

/**
 * The header's "File a report" block, and the three report types behind it.
 *
 * The team's brief puts the reporting options at the top right, as solid
 * blocks. One block rather than three: the palette names one report button, and
 * one block still fits beside the logo on a 320px phone.
 *
 * It opens a choice instead of going straight to the form, because the form
 * used to preselect "roadkill, dead" when opened from here — a live sighting
 * filed from the header could be recorded as a dead animal. Every choice below
 * says what it is.
 *
 * A native <details>, so it opens and closes by keyboard and even with no
 * JavaScript. The script adds only what <details> lacks: Escape and a click
 * elsewhere close it, and it closes after a choice is followed.
 *
 * Text on the orange is dark on purpose. White on the team's orange is 3.4:1,
 * below the 4.5:1 that text needs; ink-950 is 6.1:1.
 */
export default function ReportMenu({
  label,
  shortLabel,
  choices,
  plain = false,
  className = "",
}: {
  label: string;
  /**
   * Below `sm`. At 320px "FILE A REPORT" beside the wordmark pushed the English
   * header 8px off the screen; "REPORT" fits, and 我要通報 fits either way.
   */
  shortLabel: string;
  /** In the system face. The map's header uses no web font (see SiteHeader). */
  plain?: boolean;
  choices: ReportChoice[];
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  // Following a choice navigates client-side, which does not close <details>.
  useEffect(() => {
    ref.current?.removeAttribute("open");
  }, [pathname]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPointer = (e: PointerEvent) => {
      if (el.open && !el.contains(e.target as Node)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && el.open) {
        el.open = false;
        el.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <details ref={ref} className={`group relative ${className}`}>
      <summary className={`flex h-full min-h-11 cursor-pointer list-none items-center gap-2 bg-ember-500 px-3 text-ink-950 transition select-none hover:bg-ember-400 sm:px-6 [&::-webkit-details-marker]:hidden ${plain ? "text-[14px] font-semibold" : "font-display text-[16px] font-bold uppercase tracking-[0.06em] sm:text-[18px]"}`}>
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{label}</span>
        <svg aria-hidden viewBox="0 0 12 12" className="size-3 transition group-open:rotate-180" fill="currentColor">
          <path d="M2 4.25 6 8.25l4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute right-0 top-full z-40 hidden group-open:block w-[min(20rem,calc(100vw-2rem))] border border-forest-950/15 bg-paper-50 shadow-[0_18px_40px_-18px_rgb(15_42_34/0.55)]">
        <ul className="py-1.5">
          {choices.map((c) => (
            <li key={c.href}>
              <Link
                href={c.href}
                className="block px-5 py-3 transition hover:bg-paper-100 focus-visible:bg-paper-100"
              >
                <span className="block text-[16px] font-semibold text-forest-900">{c.label}</span>
                <span className="mt-0.5 block text-[14px] leading-snug text-ink-700">{c.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
