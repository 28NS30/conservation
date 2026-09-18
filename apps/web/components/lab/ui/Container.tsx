/**
 * The two measures, and the gutters.
 *
 * Only two widths exist (direction.md §2.4): 1200px for a page and 680px for
 * prose. A third would be someone's judgement about one particular block, and
 * the point of a measure is that it is the same everywhere.
 */
export default function Container({
  width = "page",
  className = "",
  children,
}: {
  width?: "page" | "prose";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`mx-auto w-full px-(--gutter) ${
        width === "prose"
          ? "max-w-(--container-prose)"
          : "max-w-(--container-page)"
      } ${className}`}
    >
      {children}
    </div>
  );
}
