import type { LabCopy } from "@/lib/lab/copy";

/**
 * direction.md's own "must show" table, with the verdicts filled in.
 *
 * The table exists in the design document as two columns of expectations that
 * nobody has ticked off. The value of putting it here is the third column: for
 * each row, whether a script answered it and what the script said, or whether
 * it is a thing only a person can answer — and if so, that nobody has yet.
 *
 * NOT A `<table>`. It is four columns wide, and a four-column table on a 390px
 * phone is either a sideways scroll or four stacked cells with invisible
 * headers. As blocks, each criterion reads the same at both widths: what each
 * direction has to show, then what is known about whether it does.
 *
 * `sun` is last and is the row this whole exercise turns on. It is the one
 * criterion the recommended direction can fail, it was written down as a cost
 * rather than discovered as a bug, and no amount of measuring settles it: the
 * lowest density class on a dark map is about 1.22:1 through a sunlight veil,
 * and whether that is usable is a thing you find out by going outside.
 */
const ROWS = [
  "identity",
  "map",
  "species",
  "surfaces",
  "budgets",
  "access",
  "sun",
] as const;

const MEASURED = new Set(["map", "budgets", "access"]);

export default function MustShow({ copy }: { copy: LabCopy }) {
  return (
    <ul className="mt-8">
      {ROWS.map((key) => {
        const row = copy.compare.must[key];
        return (
          <li key={key} className="rule-quiet border-t py-8 first:border-t-0 first:pt-0">
            <h3 className="t-head">{row.label}</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2 md:gap-10">
              <div>
                <p className="t-note font-bold text-(--fg-quiet)">
                  {copy.compare.columnRoundel}
                </p>
                <p className="t-body mt-1">{row.roundel}</p>
              </div>
              <div>
                <p className="t-note font-bold text-(--fg-quiet)">
                  {copy.compare.columnJournal}
                </p>
                <p className="t-body mt-1">{row.journal}</p>
              </div>
            </div>
            <p className="t-body mt-4">
              <span className="font-bold">
                {MEASURED.has(key) ? copy.compare.measured : copy.compare.needsEyes}
                {" — "}
              </span>
              {row.verdict}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
