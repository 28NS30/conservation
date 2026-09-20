/**
 * Flat bars in the real block colour, on the grid the content will land on.
 *
 * No shimmer. A shimmer is an animation that says "something is happening"
 * while nothing is, it costs a repaint on every frame on the phone least able
 * to afford one, and under `prefers-reduced-motion` it has to be turned off
 * anyway — at which point what is left is this.
 *
 * The sr-only label is not optional: a screen reader gets no signal at all from
 * a grey rectangle, and "loading" is the only thing the reader needs.
 */
export default function Skeleton({
  label,
  lines = 3,
  height = 20,
  className = "",
}: {
  /** Localised, from `lib/lab/copy.ts`. */
  label: string;
  lines?: number;
  height?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="mb-2 block bg-(--skeleton)"
          style={{ height: `${height}px`, width: i === lines - 1 ? "60%" : "100%" }}
        />
      ))}
    </div>
  );
}
