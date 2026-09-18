import { Link } from "@/i18n/navigation";

/**
 * A sign. The only thing on either design that is a filled rectangle.
 *
 * direction.md §2.6 rule 2 is the whole interface language in one line: a
 * filled rectangle is an action, an underlined word is a filter, a glyph plus
 * words is a status. Nothing is a pill. So this component is deliberately hard
 * to use for anything that is not an action — there is no "ghost" size, no icon
 * variant and no small step, because every one of those has historically become
 * a pill within a month.
 *
 * Three variants and no more. Primary is the one ember element allowed in a
 * content viewport ("press here"). Secondary is a block of the other material —
 * forest on paper, an outline on forest — which is what keeps two adjacent
 * actions from reading as two primaries. Tertiary is an outline of the text
 * colour.
 *
 * DISABLED IS NEVER DEAD. `disabled` sets `aria-disabled` and leaves the
 * control focusable and clickable, because the report flow's pinned button has
 * to be reachable in order to say what is missing — the live form disables
 * submit outright, and offline that is a button nobody can ever use. The caller
 * decides what a click does while unready; this component only prints the
 * reason, which is the other half of direction.md's "the reason printed beside
 * it".
 */
export type LabButtonProps = {
  children: React.ReactNode;
  /** Renders a link instead of a button. Internal paths are locale-prefixed. */
  href?: string;
  /** An absolute URL, or a live route that must escape the lab's locale Link. */
  external?: boolean;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "secondary" | "tertiary";
  /** 48px, or 56px in heroes and on a submit bar. */
  size?: "default" | "hero";
  block?: boolean;
  disabled?: boolean;
  /** Printed beneath the sign in the alert colour; say what is missing. */
  disabledReason?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLElement>;
  id?: string;
  lang?: string;
  className?: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  "aria-describedby"?: string;
  "aria-current"?: "page" | "true";
};

const VARIANTS = {
  primary: "bg-(--action) text-(--action-fg) hover:bg-(--action-hover)",
  // The transparent border keeps a secondary sign exactly the same size as a
  // primary one on surfaces where it has no outline, so a row of two does not
  // shift by 4px between paper and forest.
  secondary:
    "border-2 border-(--secondary-rule) bg-(--secondary-bg) text-(--secondary-fg)",
  tertiary: "border-2 border-(--fg) text-(--fg) hover:bg-(--hover)",
} as const;

export default function Button({
  children,
  href,
  external = false,
  type = "button",
  variant = "primary",
  size = "default",
  block = false,
  disabled = false,
  disabledReason,
  onClick,
  id,
  lang,
  className = "",
  ...aria
}: LabButtonProps) {
  const classes = [
    "inline-flex items-center justify-center gap-2 px-6 text-center",
    "t-lead t-label font-bold transition-colors duration-150",
    "rounded-(--radius-sign)",
    size === "hero" ? "min-h-14" : "min-h-12",
    block ? "w-full" : "",
    // An unready sign loses its fill and keeps its shape, so the layout does
    // not jump at the moment it becomes pressable.
    disabled ? VARIANTS.tertiary + " opacity-70" : VARIANTS[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const shared = {
    id,
    lang,
    className: classes,
    onClick,
    ...aria,
    ...(disabled ? { "aria-disabled": true as const } : {}),
    ...(disabledReason && id
      ? { "aria-describedby": `${id}-reason` }
      : {}),
  };

  const sign = href ? (
    external ? (
      <a
        {...shared}
        href={href}
        {...(/^https?:/.test(href)
          ? { target: "_blank", rel: "noreferrer" }
          : {})}
      >
        {children}
      </a>
    ) : (
      <Link {...shared} href={href}>
        {children}
      </Link>
    )
  ) : (
    <button {...shared} type={type}>
      {children}
    </button>
  );

  if (!disabledReason) return sign;

  return (
    <span className={block ? "block w-full" : "inline-flex flex-col gap-2"}>
      {sign}
      <span
        id={id ? `${id}-reason` : undefined}
        className="mt-2 block t-note text-(--alert)"
      >
        {disabledReason}
      </span>
    </span>
  );
}
