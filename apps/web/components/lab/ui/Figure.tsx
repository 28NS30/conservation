/**
 * A chart or an embedded map, under a heading that states the finding.
 *
 * The heading is not "Records by month" — it is what the chart shows, in a
 * sentence: 2011–2017 年間有 3,978 筆紀錄，四月最多。A reader who never looks at
 * the graphic still leaves knowing the thing it was drawn to say, which is also
 * the accessible version of a chart that no `aria-label` has ever achieved.
 *
 * The `<details>` table is the other half of that: the numbers, readable,
 * copyable and not behind a canvas. It is closed by default because it is a
 * fallback, not the content.
 */
export default function Figure({
  finding,
  findingId,
  headingLevel = 2,
  children,
  dataLabel,
  dataTable,
  source,
  id,
  className = "",
}: {
  /** A sentence, not a label. */
  finding: React.ReactNode;
  findingId?: string;
  headingLevel?: 2 | 3;
  children: React.ReactNode;
  /** The `<summary>` text, e.g. 資料表 / Data table. */
  dataLabel?: React.ReactNode;
  dataTable?: React.ReactNode;
  source?: React.ReactNode;
  id?: string;
  className?: string;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <figure id={id} className={`m-0 ${className}`}>
      <figcaption>
        <Heading id={findingId} className="t-head text-(--fg)">
          {finding}
        </Heading>
      </figcaption>
      <div className="mt-6">{children}</div>
      {dataTable ? (
        <details className="mt-4">
          <summary className="t-note min-h-11 cursor-pointer text-(--fg) content-center">
            {dataLabel}
          </summary>
          <div className="mt-2">{dataTable}</div>
        </details>
      ) : null}
      {source ? (
        <p className="t-note mt-4 text-(--fg-quiet)">{source}</p>
      ) : null}
    </figure>
  );
}
