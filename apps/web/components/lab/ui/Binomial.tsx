/**
 * A scientific name, and its authority upright beside it.
 *
 * `lang="la"` is doing real work rather than being pedantry. The live stylesheet
 * uprights `em` and `i` inside Chinese text — correct, because Chinese does not
 * italicise for emphasis — and that rule would flatten every binomial on a
 * Chinese page. Marking the name as Latin is both true and what lets base.css
 * put the italic back.
 *
 * The authority (`Günther, 1864`) is never italic; that is the convention, and
 * getting it wrong is the kind of thing the researchers this site is partly for
 * notice immediately.
 */
export default function Binomial({
  children,
  authority,
  className = "",
}: {
  children: React.ReactNode;
  authority?: string;
  className?: string;
}) {
  return (
    <span className={className}>
      <i lang="la">{children}</i>
      {authority ? (
        <span className="not-italic"> {authority}</span>
      ) : null}
    </span>
  );
}
