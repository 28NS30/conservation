import { useLocale } from "next-intl";

/**
 * The title block every inner page opens with.
 *
 * Extracted because each page had grown its own: a 20px h1 over an 11px grey
 * line on one, a 14px lede on the next, with the `mt-3` that used to clear the
 * old floating header still baked in. The shared shell provides that spacing
 * now, so the pages only need to agree on what a page title looks like.
 *
 * /about is deliberately not built on this — it opens with the mark, because it
 * is the page a stranger reads to find out who is behind the project.
 *
 * In the team's design since the redesign reached the report pages and the
 * forum: the display face in forest green, capitals in English, and the short
 * orange rule the home page's section heads use (ForumHeading is the same
 * title). It was a 30px semibold sans over a 14px grey line, which made the
 * eleven inner pages look like they belonged to an older site than the
 * header above them.
 */
export default function PageHeader({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  /** Controls that belong with the title — search, filter chips. */
  children?: React.ReactNode;
}) {
  const zh = useLocale().startsWith("zh");
  return (
    <header className="mb-8">
      <h1
        className={`font-display text-[clamp(2.1rem,6vw,3.2rem)] font-bold leading-[1.05] text-forest-900 [overflow-wrap:anywhere] [text-wrap:balance] ${
          zh ? "tracking-[0.04em]" : "uppercase tracking-[0.01em]"
        }`}
      >
        {title}
      </h1>
      <span aria-hidden className="mt-4 block h-1 w-14 bg-ember-500" />
      {lede && (
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-800">
          {lede}
        </p>
      )}
      {children}
    </header>
  );
}

/**
 * A sub-heading inside a prose page (/privacy, /attribution).
 *
 * These were 12px uppercase grey — smaller and fainter than the body text they
 * introduced, which inverts the hierarchy and makes a long page read as one
 * undifferentiated block.
 *
 * The body under them was 14px in a grey-green. These are the pages people
 * read to decide whether to trust the project with a report (/privacy,
 * /terms), and the team's brief asks for black text: 16px, ink-800.
 */
export function ProseSection({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      {title && (
        <h2 className="text-xl font-semibold text-forest-900">{title}</h2>
      )}
      <div className="mt-3 text-base leading-relaxed text-ink-800">
        {children}
      </div>
    </section>
  );
}
