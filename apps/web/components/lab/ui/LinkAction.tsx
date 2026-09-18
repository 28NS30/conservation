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
 *
 * With no `href` it renders a `<button>` and looks identical. Some of these
 * words genuinely go nowhere — 清除篩選 changes what the map is showing without
 * changing the page — and the alternatives were both worse: an `<a href="">`
 * that calls preventDefault is a link a middle-click opens, and a filled
 * rectangle would say "action" for something the interface language says is a
 * word (§2.6 rule 2).
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
  /** Omit for a word that acts rather than navigates; it renders a button. */
  href?: string;
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

  if (href === undefined) {
    return (
      <button
        id={id}
        lang={lang}
        type="button"
        className={classes}
        onClick={onClick}
        {...aria}
      >
        {body}
      </button>
    );
  }

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
