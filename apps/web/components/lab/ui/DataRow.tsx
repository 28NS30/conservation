import { Link } from "@/i18n/navigation";
import Binomial from "./Binomial";

/**
 * A list where the whole row is the target.
 *
 * 64px minimum, because the thing being tapped is a species on a phone at the
 * roadside and a 20px link inside a row is a miss. One rule between rows at 20%
 * of the ink, which is decorative — it separates, it does not box.
 *
 * NEVER a coordinate. These lists are built from `reports_public`, where
 * sensitive locations are already blurred, and printing a lat/lng in a list
 * would undo that for anyone who reads two rows of the same species. A row says
 * what and when; where is the map's job, at the precision the database chose.
 */
export function List({
  children,
  className = "",
  "aria-labelledby": labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <ul
      aria-labelledby={labelledBy}
      className={`rule-quiet w-full border-t ${className}`}
    >
      {children}
    </ul>
  );
}

export function DataRow({
  href,
  external = false,
  name,
  nameSize = "lead",
  binomial,
  authority,
  meta,
  value,
  valueLabel,
  status,
  className = "",
}: {
  href?: string;
  external?: boolean;
  name: React.ReactNode;
  /**
   * `head` is for a row that is a way in rather than an entry in a list — home's
   * seven route links, which §4 sets at `text-head` in the functional face at
   * 700 rather than in the display face. `t-plain` is what keeps the size
   * without the voice; see the note on it in `base.css`.
   */
  nameSize?: "lead" | "head";
  binomial?: string;
  authority?: string;
  /** A date, a county, a source — never a coordinate. */
  meta?: React.ReactNode;
  /** Right-aligned count. */
  value?: React.ReactNode;
  /** Read out with the count, e.g. "records"; the column head is not enough. */
  valueLabel?: string;
  /** StatusTags, beneath the name. */
  status?: React.ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <span className="min-w-0">
        <span
          className={
            nameSize === "head"
              ? "t-head t-plain block"
              : "t-lead block font-bold"
          }
        >
          {name}
        </span>
        {binomial ? (
          <Binomial authority={authority} className="t-body block text-(--fg-quiet)">
            {binomial}
          </Binomial>
        ) : null}
        {meta ? <span className="t-body block text-(--fg-quiet)">{meta}</span> : null}
        {status ? <span className="mt-1 flex flex-wrap gap-4">{status}</span> : null}
      </span>
      {value !== undefined ? (
        <span className="t-lead shrink-0 text-right">
          {value}
          {valueLabel ? <span className="sr-only"> {valueLabel}</span> : null}
        </span>
      ) : null}
    </>
  );

  const inner =
    "flex min-h-16 w-full items-center justify-between gap-6 py-3 text-(--fg) transition-colors duration-150";

  return (
    <li className="rule-quiet border-b">
      {href ? (
        external ? (
          <a href={href} className={`${inner} hover:bg-(--hover) ${className}`}>
            {body}
          </a>
        ) : (
          <Link href={href} className={`${inner} hover:bg-(--hover) ${className}`}>
            {body}
          </Link>
        )
      ) : (
        <div className={`${inner} ${className}`}>{body}</div>
      )}
    </li>
  );
}
