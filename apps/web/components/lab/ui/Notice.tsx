/**
 * A sentence the reader has to be told, with a bar beside it and no box.
 *
 * Carries the blurred-location message and the injured-wildlife referral — the
 * two things this site has to say and has so far said either in 10px grey or
 * not at all. No fill, because a filled box on cream is a card, and cards are
 * for things you can pick up.
 *
 * `role="alert"` only for something that appeared in response to what the
 * reader just did. A notice that is part of the page from the start is a
 * `note`; announcing it on load interrupts a screen reader mid-heading for
 * information that was never urgent.
 */
export default function Notice({
  tone = "info",
  title,
  children,
  id,
  live = false,
  className = "",
}: {
  tone?: "info" | "error";
  title?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  /** Set only when this appeared in response to an action. */
  live?: boolean;
  className?: string;
}) {
  return (
    <div
      id={id}
      role={live ? "alert" : "note"}
      className={`border-l-4 pl-4 ${
        tone === "error" ? "border-(--alert)" : "border-(--fg-quiet)"
      } ${className}`}
    >
      {title ? (
        <p
          className={`t-body font-bold ${
            tone === "error" ? "text-(--alert)" : "text-(--fg)"
          }`}
        >
          {title}
        </p>
      ) : null}
      <div className="t-body text-(--fg)">{children}</div>
    </div>
  );
}
