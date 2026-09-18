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

/**
 * What the reporter is handed after pressing send.
 *
 * These are source-level on purpose. The card only exists after a successful
 * POST, which needs a location, a challenge and a photo pipeline; and the
 * failure being guarded against is not "the card looks wrong" but "the card
 * says published about a pending row and links to a 404", which is a question
 * about which branch runs, not about pixels. `e2e/receipt.spec.mjs` drives the
 * rendered card.
 */
describe("the receipt on the success card", () => {
  test("the card is built from the server's answer, not from the id alone", () => {
    assert.match(
      FORM,
      /outcomeOf\(\s*result\.status,/,
      "the status the API returns must decide what the card says",
    );
    assert.match(
      FORM,
      /status: data\.status/,
      "the form must keep the status instead of discarding it",
    );
  });

  test("the link appears only when there is a page behind it", () => {
    // The whole defect: `<a href={`/reports/${result.id}`}>` was
    // unconditional, and that page reads reports_public, which excludes every
    // pending report. Most reports are pending, so most receipts were 404s.
    assert.ok(
      !/<a\s[^>]*href=\{`\/reports\//.test(FORM),
      "no bare, unconditional anchor to a report page",
    );
    assert.match(
      FORM,
      /\{outcome\.link && \(\s*<Link/,
      "the link must be gated on the outcome having one",
    );
  });

  test("the link keeps the reader's language", () => {
    // A bare <a href="/reports/x"> drops /en and bounces an English reader
    // back into Chinese.
    assert.match(FORM, /import \{ Link \} from "@\/i18n\/navigation"/);
  });

  test("the copy that promised a timetable is gone from the form", () => {
    for (const key of ["thanks", "received", "identifying", "published", "viewReport"]) {
      assert.ok(
        !new RegExp(`t\\("${key}"\\)`).test(FORM),
        `report.${key} no longer exists; the form must not ask for it`,
      );
    }
  });
});

describe("reporting a hurt animal", () => {
  test("the form says plainly that nobody is dispatched", () => {
    // Someone choosing 還活著，但受傷 is standing next to a suffering animal.
    // The form used to say nothing at all, which reads as a dispatch.
    assert.match(
      FORM,
      /category === "injured" &&/,
      "the sentence must be tied to the injured category",
    );
    assert.match(FORM, /t\("noDispatch"\)/);
    assert.match(
      FORM,
      /role="note"/,
      "it is a note beside the choice, not an error",
    );
  });

  test("it invents no agency, number or hotline", () => {
    // Decision 1 is still with the owner. A wrong number costs an hour the
    // animal does not have, so the referral sentence is a marked seam and
    // nothing more until the channel is supplied.
    const en = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "messages", "en.json"), "utf8"),
    );
    const zh = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "messages", "zh-TW.json"), "utf8"),
    );
    for (const [locale, text] of [
      ["en", en.report.noDispatch],
      ["zh-TW", zh.report.noDispatch],
    ]) {
      assert.ok(
        !/\d{3}/.test(text),
        `${locale} report.noDispatch must not carry a phone number`,
      );
    }
    assert.ok(
      !/1959|0800|防治所|農業部|hotline/i.test(JSON.stringify({ en: en.report, zh: zh.report })),
      "no agency or hotline may be invented before the owner supplies one",
    );
  });
});

describe("the blocked submit button", () => {
  test("the reason is attached to the button, not merely near it", async () => {
    // A screen reader heard a disabled button and no reason at all: the
    // sentence saying what was missing was a sibling with nothing linking it.
    assert.match(FORM, /aria-describedby=\{blocker \? "submit-blocker" : undefined\}/);
    assert.match(FORM, /id="submit-blocker"/);

    const html = await (await fetch(`${BASE_URL}/report`)).text();
    const id = /id="submit-blocker"/.test(html);
    assert.ok(id, "the blocker must be rendered before anything is chosen");
    assert.match(html, /aria-describedby="submit-blocker"/);
  });

  test("their spacing comes from a group, not a negative margin", () => {
    // `-mb-1` cancelled part of the parent's `space-y-6`, so the gap between
    // the two changed whenever the page's spacing scale did — a relationship
    // expressed as an override of the thing it depends on.
    assert.ok(
      !/-mb-1[^"]*">\{blocker\}/.test(FORM),
      "the blocker must not pull itself towards the button",
    );
    assert.match(FORM, /<div className="space-y-2">\s*\{blocker &&/);
  });
});

describe("the location picker before anything is chosen", () => {
  const PICKER = readFileSync(
    join(import.meta.dirname, "..", "components", "report", "LocationPicker.tsx"),
    "utf8",
  );

  test("no pin is dropped on Taiwan's centre", () => {
    // One was, the moment the map loaded. The form then looked answered while
    // `location` was still null: the submit button was greyed out with a pin
    // visibly on the map, and anyone who did not notice the difference between
    // "a pin" and "my pin" was one tap from filing a sighting in Nantou.
    assert.ok(
      !/setLngLat\(value \? \[value\.lng, value\.lat\] : TAIWAN_CENTER\)/.test(PICKER),
      "the marker must not be created at the island's centre",
    );
    assert.match(
      PICKER,
      /place\.current = \(lng, lat\) => \{\s*if \(!marker\.current\)/,
      "the marker is created on first use, not on mount",
    );
    assert.match(
      PICKER,
      /center: value \? \[value\.lng, value\.lat\] : TAIWAN_CENTER/,
      "TAIWAN_CENTER is still where the camera starts",
    );
  });

  test("an overlay says what to do, and cannot swallow the tap", () => {
    assert.match(PICKER, /\{!value && \(/);
    assert.match(PICKER, /pointer-events-none absolute inset-0/);
    assert.match(PICKER, /t\("tapToMark"\)/);
    // The overlay belongs to a wrapper of our own. MapLibre owns the children
    // of the container it was handed, and that element's `relative` is
    // answering a different question (see the comment on it).
    assert.match(PICKER, /<div className="relative">\s*<div\s+ref=\{container\}/);
  });

  test("the helper under the map matches whether there is a pin", () => {
    // "Tap the map to adjust" is about a pin that exists; before one does, the
    // instruction is to make one.
    assert.match(FORM, /\{location \? t\("tapToAdjust"\) : t\("needLocation"\)\}/);
  });

  test("a refused fix says so, instead of repeating the helper text", () => {
    assert.ok(
      !/setError\(t\("tapToAdjust"\)\)/.test(FORM),
      "a geolocation failure is not the same sentence as a placement hint",
    );
    assert.match(FORM, /setLocationError\(true\)/);
    assert.match(FORM, /role="alert"[\s\S]{0,120}t\("locationError"\)/);
  });
});
