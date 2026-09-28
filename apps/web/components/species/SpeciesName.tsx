import { speciesNames, type NameFields, type NamePart } from "@/lib/speciesNames";

/**
 * A species' names as markup: each in a span that carries its language, so a
 * screen reader speaks 黑眶蟾蜍 with a Chinese voice on the English page and
 * "Asian Common Toad" with an English one on the Chinese page, and only the
 * scientific name in italics. The rule for which name leads is speciesNames().
 *
 * No hooks, so it renders in server and client components alike; the caller
 * passes the locale it already has.
 *
 * `stack` is for headings and list entries: the leading name on its own line,
 * the other two after it. `inline` is one run of text for a table cell or a map
 * popup, where the scientific name is dropped to save the room unless it is the
 * only name there is. `primary` is the leading name alone, for a chip or a
 * label too small for two.
 */
export default function SpeciesName({
  species,
  locale,
  layout = "stack",
  primaryClassName = "",
  secondaryClassName = "",
  author,
}: {
  species: NameFields;
  locale: string;
  layout?: "stack" | "inline" | "primary";
  primaryClassName?: string;
  secondaryClassName?: string;
  /** The authority, set after the scientific name on a species' own page. */
  author?: string | null;
}) {
  const n = speciesNames(species, locale);

  if (layout === "primary") return <Part part={n.primary} className={primaryClassName} />;

  if (layout === "inline") {
    return (
      <>
        <Part part={n.primary} className={primaryClassName} />
        {n.other && (
          <>
            <span aria-hidden> · </span>
            <Part part={n.other} className={secondaryClassName} />
          </>
        )}
      </>
    );
  }

  const rest = [n.other, n.scientific].filter((p): p is NamePart => p !== null);
  // The authority belongs after the scientific name, wherever that is.
  const by = author ? (
    <span className="ml-1.5 not-italic font-normal opacity-80">{author}</span>
  ) : null;
  return (
    <>
      <span className={`block ${primaryClassName}`}>
        <Part part={n.primary} />
        {!n.scientific && by}
      </span>
      {rest.length > 0 && (
        <span className={`block ${secondaryClassName}`}>
          {rest.map((p, i) => (
            <span key={p.lang}>
              {i > 0 && <span aria-hidden> · </span>}
              <Part part={p} />
              {p === n.scientific && by}
            </span>
          ))}
        </span>
      )}
    </>
  );
}

function Part({ part, className = "" }: { part: NamePart; className?: string }) {
  return (
    <span lang={part.lang} className={`${part.italic ? "italic" : "not-italic"} ${className}`.trim()}>
      {part.text}
    </span>
  );
}
