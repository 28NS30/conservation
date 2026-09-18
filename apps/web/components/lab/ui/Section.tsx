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
  heading = "block",
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
  /**
   * Where the heading sits, which is the one structural difference the two
   * directions are allowed. Roundel puts it above the content at `title` size
   * on a block of its own colour. The Field journal has no blocks to put it on:
   * there a section is opened by a 2px rule with the heading out in the left
   * margin at `head` size, which is that direction's whole idea of hierarchy
   * (§3, "rules instead of surfaces"). Everything below the heading is the same
   * components in the same order either way.
   */
  heading?: "block" | "margin";
  /** The 2px line that opens a section. Off for a hero, which opens nothing. */
  rule?: boolean;
  width?: "page" | "prose";
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  // A margin with nothing in it is just an indent, so a section with no title
  // keeps the full measure whichever placement it was asked for.
  const inMargin = heading === "margin" && Boolean(title);

  return (
    <section
      id={id}
      data-surface={surface}
      aria-labelledby={title && titleId ? titleId : undefined}
      className={`bg-(--ground) text-(--fg) ${className}`}
    >
      <Container width={width}>
        <div
          className={[
            rule ? "rule-strong border-t-2 pt-10" : "",
            // 18rem is nine Hanzi at the journal's 32px heading step, which is
            // what 這一週，在別的年份 needs to stay on one line. It only widens
            // from `lg`: at 768px that margin would leave the content column
            // narrower than the two lists inside it can use.
            inMargin
              ? "md:grid md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:gap-10 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {title ? (
            <Heading
              id={titleId}
              className={inMargin ? "t-head mb-6 md:mb-0" : "t-title mb-10"}
            >
              {title}
            </Heading>
          ) : null}
          <div className="min-w-0">{children}</div>
        </div>
      </Container>
    </section>
  );
}
