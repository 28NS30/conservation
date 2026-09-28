/**
 * The controls that decide what a report IS, asserted at source.
 *
 * These are about what a control does when pressed, which needs no database
 * and no server — and needs none deliberately, because the most consequential
 * field on the form should be checkable from a clean checkout.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FORM = readFileSync(
  join(import.meta.dirname, "..", "components", "report", "ReportForm.tsx"),
  "utf8",
);

describe("the kind of report", () => {
  test("there is no chip that re-chooses it", () => {
    // The group chips were the defect's home. Re-pressing the pressed one ran
    // `setCategory(first)`, and `first` was the group's FIRST category — so a
    // reporter who chose 還活著，但受傷 and then touched 路殺或受傷 had their
    // answer replaced with 已死亡. The page is the kind of report now, so the
    // chips, and that way of losing an answer, are gone.
    assert.doesNotMatch(FORM, /setCategory\(first\)/);
    assert.doesNotMatch(FORM, /REPORT_GROUPS/);
  });

  test("the dead-or-hurt answer sets the category directly", () => {
    // The answer IS the raw category value — 已死亡 and 還活著，但受傷 are two
    // stored categories, not a category plus a flag.
    assert.match(FORM, /onClick=\{\(\) => setCategory\(k\)\}/);
  });

  test("and it starts unanswered", () => {
    // `useState<Category>(initialCategory ?? "roadkill")` was the default that
    // filed a live animal as a dead one. A page with a question starts null,
    // and the button will not send a null category.
    assert.doesNotMatch(FORM, /\?\? "roadkill"/);
    assert.match(FORM, /useState<Category \| null>\(\(\) =>\s*initialCategoryFor\(page\),?\s*\)/);
    assert.match(FORM, /needsCondition: category === null/);
    assert.match(FORM, /if \(!location \|\| !category\) return;/);
  });
});
