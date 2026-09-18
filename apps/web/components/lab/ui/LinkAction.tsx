import { Link } from "@/i18n/navigation";

/**
 * A word you can press, inside or beside running text.
 *
 * Not a sign: a sign is a rectangle and there is at most one ember rectangle in
 * a viewport, so everything else that leads somewhere is a word with a 2px
 * ember line under it. The line is offset 4px so it never crosses a Hanzi
 * descender, and the colour comes from `--accent-text`, which is the one ember
 * step each surface allows as a line — ember-700 on paper, the darker step on
 * cream, the lighter one on forest.
 *
 * `standalone` gives it a 44px hit height. A link on its own line is a target;
 * one inside a sentence is not, and padding it out would open holes in the
 * paragraph.
 */
export default function LinkAction({
  href,
  children,
  external = false,
  arrow = false,
  standalone = false,
  className = "",
  onClick,
  id,
  lang,
  ...aria
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
  /** A trailing arrow, for a link that opens another view of the same thing. */
  arrow?: boolean;
  standalone?: boolean;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
  id?: string;
  lang?: string;
  "aria-label"?: string;
  "aria-current"?: "page" | "true";
}) {
  const classes = [
    "lab-underline text-(--fg) underline decoration-2 underline-offset-4",
    standalone ? "inline-flex min-h-11 items-center gap-2" : "inline",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      {children}
      {arrow ? <span aria-hidden="true"> →</span> : null}
    </>
  );

  if (external) {
    return (
      <a
        id={id}
        lang={lang}
        href={href}
        className={classes}
        onClick={onClick}
        {...(/^https?:/.test(href)
          ? { target: "_blank", rel: "noreferrer" }
          : {})}
        {...aria}
      >
        {body}
      </a>
    );
  }

  return (
    <Link
      id={id}
      lang={lang}
      href={href}
      className={classes}
      onClick={onClick}
      {...aria}
    >
      {body}
    </Link>
  );
}
