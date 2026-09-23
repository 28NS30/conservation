/**
 * The category controls, asserted at source.
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

describe("the group chips", () => {
  test("re-pressing the pressed one does not reset the condition", () => {
    // `onClick={() => setCategory(first)}` with no guard: `first` is the
    // group's FIRST category, so a reporter who chose 還活著，但受傷 and then
    // touched the 路殺或受傷 chip above it — already active — had their answer
    // replaced with 已死亡. A live animal recorded as a dead one, silently,
    // by pressing a button that was already pressed.
    assert.doesNotMatch(
      FORM,
      /onClick=\{\(\) => setCategory\(first\)\}/,
      "the chip sets the category unconditionally",
    );
    assert.match(
      FORM,
      /if \(group !== g\) setCategory\(first\)/,
      "the chip should only act when it changes the group",
    );
  });

  test("the condition sub-choice still sets the category directly", () => {
    // The sub-choice IS the raw category value — 已死亡 and 還活著，但受傷 are
    // two stored categories, not a category plus a flag. Guarding that one
    // would break choosing between them.
    assert.match(FORM, /onClick=\{\(\) => setCategory\(k\)\}/);
  });
});
