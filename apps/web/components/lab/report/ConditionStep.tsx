"use client";

import Choice from "@/components/lab/ui/Choice";
import PageTitle from "@/components/lab/ui/PageTitle";
import type { LabCopy } from "@/lib/lab/copy";
import type { Condition } from "@/lib/lab/deriveCategory";
import type { ReportFlow } from "./useReportFlow";

/**
 * The question that replaces "which kind of report is this".
 *
 * Three rows, nothing preselected, and the answer is about the animal rather
 * than about the database. Today's form asks for a category and quietly
 * defaults to roadkill, which is why injured animals are in the dataset as dead
 * ones; here nobody is filed anywhere until somebody says what they saw.
 *
 * A tap answers and moves on, but an arrow key only moves the selection. In a
 * radiogroup those are the same event unless something separates them, and a
 * keyboard reporter arrowing down this list would be thrown through the flow on
 * the first key press — which is why `Choice` has an `onCommit` at all.
 */
export default function ConditionStep({
  copy,
  flow,
  onAdvance,
  titleId,
  heading = "h1",
}: {
  copy: LabCopy;
  flow: ReportFlow;
  /** Handed the answer, because the state that holds it has not landed yet. */
  onAdvance?: (condition: Condition) => void;
  titleId: string;
  heading?: "h1" | "h2";
}) {
  return (
    <div>
      {heading === "h1" ? (
        <PageTitle id={titleId} size="title">
          {copy.report.conditionTitle}
        </PageTitle>
      ) : (
        <h2 id={titleId} className="t-head text-(--fg)">
          {copy.report.conditionTitle}
        </h2>
      )}
      <Choice
        className="mt-8"
        name="lab-condition"
        legend={copy.report.conditionTitle}
        hideLegend
        value={flow.state.condition ?? undefined}
        onChange={(value) => flow.setCondition(value as Condition)}
        onCommit={(value) => onAdvance?.(value as Condition)}
        options={[
          { value: "dead", label: copy.report.conditionDead },
          { value: "hurt", label: copy.report.conditionHurt },
          { value: "well", label: copy.report.conditionWell },
        ]}
      />
    </div>
  );
}
