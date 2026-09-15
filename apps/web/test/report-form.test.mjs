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

/** Whether the dead/injured sub-choice was actually rendered, not merely present
 * in the inlined message catalogue that every page ships. */
function hasCondition(html) {
  return /<h3[^>]*>牠還活著嗎？<\/h3>/.test(html);
}

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
    // Group labels, since the form now offers three groups rather than four
    // categories. A deep link to `injured` is covered separately below: it is a
    // sub-choice of the roadkill group, not a door of its own.
    for (const [key, label] of [
      ["invasive", "外來入侵種"],
      ["roadkill", "路殺或受傷"],
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
      ["路殺或受傷"],
      "falls back to the default group",
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

describe("report groups", () => {
  test("the form offers exactly the three the team asked for", async () => {
    const html = await (await fetch(`${BASE_URL}/report`)).text();
    for (const label of ["外來入侵種", "一般目擊", "路殺或受傷"]) {
      assert.ok(html.includes(label), `missing the ${label} choice`);
    }
    // The fourth button is gone: injured is a sub-choice of roadkill now, not a
    // peer of it competing for the same glance.
    const groupButtons = [
      ...html.matchAll(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g),
    ];
    assert.ok(
      groupButtons.length >= 3,
      "expected the three group buttons to be marked",
    );
  });

  test("the roadkill group asks whether the animal was alive", async () => {
    const html = await (
      await fetch(`${BASE_URL}/report?category=roadkill`)
    ).text();
    assert.ok(hasCondition(html), "the sub-choice must be shown");
    assert.ok(html.includes("已死亡") && html.includes("還活著，但受傷"));
  });

  test("the other two groups ask nothing further", async () => {
    for (const c of ["invasive", "sighting"]) {
      const html = await (
        await fetch(`${BASE_URL}/report?category=${c}`)
      ).text();
      assert.ok(
        !hasCondition(html),
        `${c} should have no condition sub-choice`,
      );
    }
  });

  test("a link straight to ?category=injured still lands in its group", async () => {
    // The group is derived from the category, so a deep link to the sub-choice
    // cannot leave the form showing a group that does not contain it.
    const html = await (
      await fetch(`${BASE_URL}/report?category=injured`)
    ).text();
    assert.ok(html.includes("牠還活著嗎？"));
    assert.deepEqual(selected(html), ["路殺或受傷"]);
  });
});
