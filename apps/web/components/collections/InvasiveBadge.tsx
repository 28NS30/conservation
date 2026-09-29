/**
 * The mark on a record whose animal is invasive.
 *
 * Driven by `reports_public.is_invasive` (0016), which reads the species every
 * time: the reporter never ticks it, and it is never stored on the report. So a
 * live sighting of an invasive species filed on the wildlife page carries it,
 * and a native animal filed on the invasive page does not — the team's
 * "make sure it's also marked", decided by the species rather than the form.
 *
 * A FILL WITH DARK TEXT, in the team's orange. ember-500 is 3.2:1 against the
 * ivory page and fails as text, so it is never used as text; ink-950 on it is
 * 6.1:1. On the map's dark panel the same pill reads the same way, so the one
 * component serves both surfaces. 14px, the site's floor for text.
 *
 * Plain markup with no hooks, so a server page and the map's client panel can
 * both render it; the words arrive already translated.
 */
export default function InvasiveBadge({
  label,
  title,
  className = "",
}: {
  label: string;
  /** Why it carries the mark, for a reader who hovers. */
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-ember-500 px-2.5 py-0.5 text-[14px] font-semibold leading-5 text-ink-950 ${className}`}
    >
      {label}
    </span>
  );
}
