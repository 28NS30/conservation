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
  return (
    <header className="mb-8">
      <h1 className="text-3xl font-semibold text-parchment-50">{title}</h1>
      {lede && (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-parchment-300">
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
        <h2 className="text-lg font-semibold text-parchment-50">{title}</h2>
      )}
      <div className="mt-3 text-sm leading-relaxed text-parchment-300">
        {children}
      </div>
    </section>
  );
}
