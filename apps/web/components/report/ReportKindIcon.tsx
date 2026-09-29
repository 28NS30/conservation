import type { ReportPage } from "@conservation/shared";

/**
 * A mark for each kind of report, so the three choices differ at a glance and
 * not only in their words.
 *
 * Decoration: the heading beside it says what it is, so it is hidden from
 * screen readers. Each sits on a different ground from the team's palette —
 * the report orange with dark ink on it (never white: 3.4:1), forest with
 * ivory, leaf with white — which is the distinction a glance catches first.
 */
const GROUND: Record<ReportPage, string> = {
  roadkill: "bg-ember-500 text-ink-950",
  invasive: "bg-forest-900 text-paper-50",
  wildlife: "bg-leaf-600 text-white",
};

export default function ReportKindIcon({
  page,
  size = "md",
}: {
  page: ReportPage;
  size?: "md" | "sm";
}) {
  const box = size === "md" ? "size-14" : "size-11";
  const glyph = size === "md" ? "size-8" : "size-6";
  return (
    <span
      aria-hidden
      className={`flex ${box} shrink-0 items-center justify-center rounded-full ${GROUND[page]}`}
    >
      <svg
        viewBox="0 0 24 24"
        className={glyph}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {page === "roadkill" && (
          // A road running into the distance, with its centre line.
          <>
            <path d="M8 3 4 21" />
            <path d="M16 3l4 18" />
            <path d="M12 4v2.5M12 10v3M12 16.5V20" />
          </>
        )}
        {page === "invasive" && (
          // A warning triangle.
          <>
            <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
            <path d="M12 9.5v4.5" />
            <path d="M12 17h.01" />
          </>
        )}
        {page === "wildlife" && (
          // Binoculars.
          <>
            <circle cx="6.5" cy="15.5" r="3.5" />
            <circle cx="17.5" cy="15.5" r="3.5" />
            <path d="M10 15.5h4" />
            <path d="M4 13.5 6.5 5h3l.5 7" />
            <path d="M20 13.5 17.5 5h-3l-.5 7" />
          </>
        )}
      </svg>
    </span>
  );
}
