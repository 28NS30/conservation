/**
 * The front page's category doors, and what they arrive at.
 *
 * Each door on the home page links to /report?category=<key> so that choosing
 * what you saw and starting the form are one act rather than the same question
 * asked twice. That contract spans three files — the page builds the link, the
 * route validates the parameter, the form takes it as its initial state — and
 * nothing else would notice if any one of them stopped honouring it.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL, sql } from "./helpers.mjs";

after(() => sql.end());

const FORM = readFileSync(
  join(import.meta.dirname, "..", "components", "report", "ReportForm.tsx"),
  "utf8",
);

/** Whether the dead/injured sub-choice was actually rendered, not merely present
 * in the inlined message catalogue that every page ships. */
function hasCondition(html) {
  return /<h3[^>]*>牠還活著嗎？<\/h3>/.test(html);
}

/**
 * The species the picker is holding, which is the only place that markup
 * appears. Not a bare substring search: every page inlines the whole message
 * catalogue, so "is this name in the HTML" would pass on a page that merely
 * mentioned it.
 */
function chosenSpecies(html) {
  return [
    ...html.matchAll(
      /class="text-\[15px\] font-medium text-ink-900">([^<]*)</g,
    ),
  ].map((m) => m[1]);
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

/**
 * The species doors.
 *
 * A species page's "report this species" carries the taxon in the query string
 * for the same reason the home page's doors carry the category: naming what you
 * saw and starting the form should be one act. The contract spans the same
 * three files, and the link is worth least on exactly the pages where it is
 * loudest — the ones that say nobody has reported this species yet.
 */
describe("species prefill", () => {
  test("a species page's report link opens the form on that species", async () => {
    // The toad the page spec already leans on. The expected name is read from
    // the database rather than written here: this is testing that the prefill
    // reaches the picker, not that TaiCOL spells anything a particular way.
    const [toad] = await sql`
      select common_name_zh as zh from taxa where id = 28758`;
    assert.ok(toad?.zh, "expected taxon 28758 in the checklist");
    const html = await (
      await fetch(`${BASE_URL}/report?taxonId=28758`)
    ).text();
    assert.deepEqual(chosenSpecies(html), [toad.zh]);
  });

  test("a species with no records prefills too", async () => {
    // The case the map's named-taxon lookup cannot serve, and the one the link
    // exists for: the empty species page invites the first report of it.
    const [none] = await sql`
      select t.id, t.common_name_zh as zh from taxa t
        left join species_report_stats s on s.taxon_id = t.id
       where s.taxon_id is null and t.is_in_taiwan
         and t.rank = 'Species' and t.common_name_zh is not null
       limit 1`;
    assert.ok(none, "expected a species with no records");
    const html = await (
      await fetch(`${BASE_URL}/report?taxonId=${none.id}`)
    ).text();
    assert.deepEqual(chosenSpecies(html), [none.zh]);
  });

  test("a bad or unknown taxonId is ignored rather than erroring", async () => {
    for (const bad of ["abc", "-1", "99999999", ""]) {
      const res = await fetch(`${BASE_URL}/report?taxonId=${bad}`);
      assert.equal(res.status, 200, `?taxonId=${bad} is not an error`);
      assert.deepEqual(
        chosenSpecies(await res.text()),
        [],
        `?taxonId=${bad} must leave the picker empty`,
      );
    }
  });

  test("a species and a category arrive together", async () => {
    const html = await (
      await fetch(`${BASE_URL}/report?category=invasive&taxonId=28758`)
    ).text();
    assert.deepEqual(selected(html), ["外來入侵種"]);
    assert.equal(chosenSpecies(html).length, 1);
  });
});
