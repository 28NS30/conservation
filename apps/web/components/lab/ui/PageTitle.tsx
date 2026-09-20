import { labFaceClass } from "@/lib/lab/fonts";

/**
 * The one h1 on the page.
 *
 * Which step it takes is the caller's decision, because it depends on the
 * content and the viewport in a way no component can know: a six-Hanzi species
 * name is `hero` on a desktop and `display` on a phone, a nine-Hanzi one drops
 * a step, and every h1 on a phone is `title` or smaller. What is fixed is that
 * it is one of the seven sizes, and that the display face never appears below
 * `head` — a black weight at 20px clogs 灣 and 蟾蜍 at 1x.
 *
 * It also decides, on its own, whether the display face can draw this title at
 * all. The lab's subsets carry about eight hundred characters and Taiwan's
 * checklist runs to tens of thousands, so a species name will eventually
 * contain a Hanzi nobody cut a glyph for. `unicode-range` makes that harmless
 * in a paragraph and ugly in an h1 — one system glyph beside six subset ones at
 * 56px reads as a bug in the page — so direction.md §2.2 says such a title goes
 * to the system face WHOLLY. Doing it here rather than at each call site is the
 * difference between a rule and a rule somebody remembered.
 */
export default function PageTitle({
  children,
  size = "title",
  phoneSize,
  id,
  lang,
  text,
  className = "",
}: {
  children: React.ReactNode;
  size?: "head" | "title" | "display" | "hero";
  /**
   * The step it takes below 768px. Not a smaller eighth size: direction.md
   * gives a phone column for every row of the scale, and every h1 on a phone is
   * `title` or below. Omitted, the desktop step is used at both widths.
   */
  phoneSize?: "body" | "lead" | "head" | "title" | "display";
  id?: string;
  /** Set when the title is in the other language, e.g. the Chinese name on /en. */
  lang?: string;
  /**
   * The words to judge the typeface by, when `children` is not a plain string —
   * a name wrapped in `Binomial`, say. A plain string needs nothing.
   */
  text?: string;
  className?: string;
}) {
  const words = text ?? (typeof children === "string" ? children : "");

  return (
    <h1
      id={id}
      lang={lang}
      className={`t-${size} ${
        phoneSize ? `t-sm-${phoneSize}` : ""
      } ${labFaceClass(words)} text-(--fg) ${className}`}
    >
      {children}
    </h1>
  );
}
