/**
 * The front page's category doors, and what they arrive at.
 *
 * Each door on the home page links to /report?category=<key> so that choosing
 * what you saw and starting the form are one act rather than the same question
 * asked twice. That contract spans three files — the page builds the link, the
 * route validates the parameter, the form takes it as its initial state — and
 * nothing else would notice if any one of them stopped honouring it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL } from "./helpers.mjs";

const FORM = readFileSync(
  join(import.meta.dirname, "..", "components", "report", "ReportForm.tsx"),
  "utf8",
);

/** The chosen category is the button drawn filled. */
function selected(html) {
  const m = [
    ...html.matchAll(
      /<button[^>]*class="[^"]*bg-ink-900 text-paper-50[^"]*"[^>]*>(.*?)<\/button>/gs,
    ),
  ];
  return m.map((x) => x[1].replace(/<[^>]+>/g, "").trim());
}

describe("report form", () => {
  test("a category door opens the form on that category", async () => {
    for (const [key, label] of [
      ["invasive", "外來入侵種"],
      ["injured", "受傷野生動物"],
      ["sighting", "一般目擊"],
    ]) {
      const html = await (
        await fetch(`${BASE_URL}/report?category=${key}`)
      ).text();
      assert.deepEqual(
        selected(html),
        [label],
        `?category=${key} should open with exactly that one chosen`,
      );
    }
  });

  test("an unknown category falls back rather than erroring", async () => {
    const res = await fetch(`${BASE_URL}/report?category=dragons`);
    assert.equal(res.status, 200, "a mistyped link is not an error");
    assert.deepEqual(
      selected(await res.text()),
      ["路殺"],
      "falls back to the default",
    );
  });

  test("the chosen category is exposed to assistive technology", async () => {
    // It was conveyed by fill colour alone: four identically-named buttons with
    // no state for a screen reader to announce.
    assert.match(
      FORM,
      /aria-pressed=\{category === k\}/,
      "category buttons must carry aria-pressed",
    );
    const html = await (
      await fetch(`${BASE_URL}/report?category=invasive`)
    ).text();
    assert.match(html, /aria-pressed="true"/);
  });
});
