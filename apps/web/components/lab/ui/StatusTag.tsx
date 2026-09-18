/**
 * Protected, endemic, invasive, blurred — a shape and a word, never a container.
 *
 * The live site draws these as coloured pills, which is how a species page ends
 * up with four things that look pressable and none of them are. Here a status
 * is 12px of geometry plus the word in the surface's own text colour, so it
 * cannot be mistaken for an action and reads at a glance in a list.
 *
 * The shapes differ from each other, not just the colours: ▲ ● ■ ◐. That is
 * what keeps them apart for a colour-blind reader, in sunlight, and on the
 * forest surface — where the fills go pale on purpose, because alert red on
 * field green is unreadable and the form is already carrying the meaning.
 *
 * Never interactive.
 */
const GLYPHS = {
  protected: "▲",
  endemic: "●",
  invasive: "■",
  blurred: "◐",
} as const;

export type StatusKind = keyof typeof GLYPHS;

export default function StatusTag({
  kind,
  children,
  size = "note",
  className = "",
}: {
  kind: StatusKind;
  /** The word. Comes from `lib/lab/copy.ts`, so this stays locale-free. */
  children: React.ReactNode;
  /** `note` in rows, `body` on a detail page. */
  size?: "note" | "body";
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-(--fg) ${
        size === "body" ? "t-body" : "t-note font-bold"
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className="leading-none"
        // 12px, and an inline style rather than an arbitrary Tailwind size: the
        // seven type steps are the only sizes on this site, and a `text-[12px]`
        // in a component is how an eighth one gets adopted. A geometric glyph
        // is not type; the floor of 14px is about Hanzi.
        style={{ color: `var(--status-${kind})`, fontSize: "12px" }}
      >
        {GLYPHS[kind]}
      </span>
      {children}
    </span>
  );
}
