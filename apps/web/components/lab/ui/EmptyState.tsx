import Button from "./Button";

/**
 * Nothing matched. Say what you are filtering by and offer to stop.
 *
 * Never a sentence about absence ("no results found"), never an illustration.
 * An empty result on this site almost always means the filters are narrower
 * than the reader realised — four of the six report categories have no records
 * at all — so the useful thing on screen is the list of what is currently on
 * and one way to clear it.
 */
export default function EmptyState({
  filters,
  clearLabel,
  clearHref,
  onClear,
  className = "",
}: {
  /** The active filters, in words. */
  filters: React.ReactNode;
  clearLabel: React.ReactNode;
  clearHref?: string;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <div className={`text-(--fg) ${className}`}>
      <p className="t-body">{filters}</p>
      <Button
        variant="tertiary"
        href={clearHref}
        onClick={onClear}
        className="mt-6"
      >
        {clearLabel}
      </Button>
    </div>
  );
}
