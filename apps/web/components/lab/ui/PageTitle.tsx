/**
 * The one h1 on the page.
 *
 * Which step it takes is the caller's decision, because it depends on the
 * content and the viewport in a way no component can know: a six-Hanzi species
 * name is `hero` on a desktop and `display` on a phone, a nine-Hanzi one drops
 * a step, and every h1 on a phone is `title` or smaller. What is fixed is that
 * it is one of the seven sizes, and that the display face never appears below
 * `head` — a black weight at 20px clogs 灣 and 蟾蜍 at 1x.
 */
export default function PageTitle({
  children,
  size = "title",
  phoneSize,
  id,
  lang,
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
  className?: string;
}) {
  return (
    <h1
      id={id}
      lang={lang}
      className={`t-${size} ${
        phoneSize ? `t-sm-${phoneSize}` : ""
      } text-(--fg) ${className}`}
    >
      {children}
    </h1>
  );
}
