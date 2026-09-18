import Container from "./Container";

/**
 * A band of the page, and the only thing that changes the ground under you.
 *
 * `surface` is direction.md's `.on-paper` / `.on-plate` / `.on-field`: it sets
 * `data-surface`, which re-points every semantic variable its children read, so
 * a Button inside a forest Section becomes an ember block with a forest label
 * without anybody passing it a prop. Nesting works, and is how a cream receipt
 * sits inside a forest page.
 *
 * Full-bleed ground, inner container. That is the Roundel move — blocks, never
 * bordered boxes — and it is also what makes the Field journal's version work
 * without a second component: there the three surfaces are near-identical
 * paper, and the 2px rule this draws over the heading is what separates one
 * section from the next.
 *
 * Two forest Sections must never touch (§2.6 rule 6). This cannot enforce that;
 * it is a page's job.
 */
export default function Section({
  surface = "paper",
  title,
  titleId,
  headingLevel = 2,
  rule = true,
  width = "page",
  id,
  className = "",
  children,
}: {
  surface?: "paper" | "plate" | "field";
  title?: React.ReactNode;
  titleId?: string;
  headingLevel?: 2 | 3;
  /** The 2px line that opens a section. Off for a hero, which opens nothing. */
  rule?: boolean;
  width?: "page" | "prose";
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <section
      id={id}
      data-surface={surface}
      aria-labelledby={title && titleId ? titleId : undefined}
      className={`bg-(--ground) text-(--fg) ${className}`}
    >
      <Container width={width}>
        <div className={rule ? "rule-strong border-t-2 pt-10" : ""}>
          {title ? (
            <Heading id={titleId} className="t-title mb-10">
              {title}
            </Heading>
          ) : null}
          {children}
        </div>
      </Container>
    </section>
  );
}
