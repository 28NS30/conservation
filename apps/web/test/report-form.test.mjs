/**
 * The three report pages, and what each one asks.
 *
 * The home page's rows and the header's menu link to /report/roadkill,
 * /report/invasive and /report/wildlife, so that choosing what you saw and
 * starting the form are one act rather than the same question asked twice.
 * The contract spans three files — the page builds the link, the route checks
 * the kind, the form takes it as what it files — and nothing else would notice
 * if any one of them stopped honouring it. The chooser and the old
 * `?category=` links are test/report-pages.test.mjs.
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

const html = async (path) => (await fetch(`${BASE_URL}${path}`)).text();

/** Whether the dead/injured question was actually rendered, not merely present
 * in the inlined message catalogue that every page ships. */
function hasCondition(page) {
  return /<h2 id="condition-label"[^>]*>牠還活著嗎？/.test(page);
}

/**
 * The species the picker is holding, which is the only place that markup
 * appears. Not a bare substring search: every page inlines the whole message
 * catalogue, so "is this name in the HTML" would pass on a page that merely
 * mentioned it.
 */
/**
 * The leading name of the species the picker shows as chosen. The picker names
 * it through <SpeciesName>, which puts each name in a span carrying its
 * language, so the chosen block's first language-tagged span is the headline.
 */
function chosenSpecies(page) {
  return [
    ...page.matchAll(
      /class="block text-\[15px\] font-medium text-ink-900"><span lang="[^"]+" class="[^"]*">([^<]*)</g,
    ),
  ].map((m) => m[1]);
}

/** Every control drawn as pressed. */
function pressed(page) {
  return [
    ...page.matchAll(/<button[^>]*aria-pressed="true"[^>]*>(.*?)<\/button>/gs),
  ].map((x) => x[1].replace(/<[^>]+>/g, "").trim());
}

describe("each page files its own kind of report", () => {
  test("every page renders, and nothing else under /report/ does", async () => {
    for (const kind of ["roadkill", "invasive", "wildlife"]) {
      const res = await fetch(`${BASE_URL}/report/${kind}`);
      assert.equal(res.status, 200, kind);
    }
    // dynamicParams = false: a kind that does not exist is not a form with
    // nothing to file, it is a 404.
    assert.equal((await fetch(`${BASE_URL}/report/dragons`)).status, 404);
    assert.equal((await fetch(`${BASE_URL}/report/sighting`)).status, 404);
  });

  test("each has its own title, in both languages", async () => {
    const title = async (p) => /<title>([^<]*)<\/title>/.exec(await html(p))?.[1] ?? "";
    assert.match(await title("/report/roadkill"), /^通報路殺或受傷動物 · /);
    assert.match(await title("/report/invasive"), /^通報外來入侵種 · /);
    assert.match(await title("/report/wildlife"), /^通報野生動物目擊 · /);
    assert.match(await title("/en/report/invasive"), /^Report an invasive species · /);
    assert.match(await title("/report"), /^我要通報 · /);
    assert.match(await title("/en/report"), /^File a report · /);
  });

  test("the category comes from the page, not from a choice of three", () => {
    // The group chips are gone: the page IS the kind of report. What each page
    // files is REPORT_PAGES in packages/shared, read here rather than copied.
    assert.doesNotMatch(FORM, /REPORT_GROUP_KEYS\.map/);
    assert.match(FORM, /REPORT_PAGES\[page\]\.categories/);
    assert.match(FORM, /category: what,\s*page,/, "the page is sent with every report");
  });
});

describe("nothing is chosen for the reporter", () => {
  test("no page opens with anything pressed or ticked", async () => {
    for (const kind of ["roadkill", "invasive", "wildlife"]) {
      const page = await html(`/report/${kind}`);
      assert.deepEqual(pressed(page), [], `${kind}: something is pressed`);
      assert.ok(!/type="checkbox"[^>]*checked=""/.test(page), `${kind}: a box is ticked`);
      assert.deepEqual(chosenSpecies(page), [], `${kind}: a species is chosen`);
    }
  });

  test("the roadkill page asks dead or hurt, and has no default", async () => {
    // The form used to open on "roadkill, dead". A live animal filed from the
    // header's report button was stored as a dead one without anybody saying so.
    const page = await html("/report/roadkill");
    assert.ok(hasCondition(page), "the question must be shown");
    const answers = [
      ...page.matchAll(/<button[^>]*aria-pressed="false"[^>]*>(.*?)<\/button>/gs),
    ].map((m) => m[1]);
    assert.deepEqual(answers, ["已死亡", "還活著，但受傷"]);
    // And the button says it is waiting for that answer before anything else.
    assert.match(page, /id="submit-blocker"[^>]*>請先選擇動物已經死亡，還是活著但受傷</);
    assert.match(
      FORM,
      /return categories\.length === 1 \? categories\[0\] : null;/,
      "a page with a question starts unanswered",
    );
  });

  test("the other two pages ask nothing further", async () => {
    for (const kind of ["invasive", "wildlife"]) {
      const page = await html(`/report/${kind}`);
      assert.ok(!hasCondition(page), `${kind} should have no dead-or-hurt question`);
    }
  });

  test("the answer is exposed to assistive technology", () => {
    assert.match(FORM, /aria-pressed=\{category === k\}/);
    assert.match(FORM, /onClick=\{\(\) => setCategory\(k\)\}/);
  });
});

describe("what each page offers", () => {
  test("the invasive page has a way out, and no way to widen the list", async () => {
    const page = await html("/report/invasive");
    assert.match(page, /href="\/report\/wildlife"[^>]*>改用野生動物目擊通報</);
    assert.ok(!page.includes("不是這些？搜尋全部物種"), "the search-all-species button is back");
    const picker = readFileSync(
      join(import.meta.dirname, "..", "components", "report", "SpeciesPicker.tsx"),
      "utf8",
    );
    assert.doesNotMatch(picker, /setWide|speciesWiden|filter", "all"/);
    // The picker asks by page, so it cannot be pointed at a wider list than
    // the server will accept.
    assert.match(picker, /new URLSearchParams\(\{ q, page \}\)/);
  });

  test("the wildlife page says when an invasive animal also counts as invasive", () => {
    const picker = readFileSync(
      join(import.meta.dirname, "..", "components", "report", "SpeciesPicker.tsx"),
      "utf8",
    );
    assert.match(picker, /page === "wildlife" && value\.isInvasive && \(/);
    assert.match(picker, /t\("alsoInvasive"\)/);
  });
});

/**
 * The species doors.
 *
 * A species page's "report this species" carries the taxon in the query
 * string, for the same reason the home page's rows carry the kind: naming
 * what you saw and starting the form should be one act.
 */
describe("species prefill", () => {
  test("a report page opens on the species it was sent", async () => {
    // The toad the page spec already leans on. The expected name is read from
    // the database rather than written here: this is testing that the prefill
    // reaches the picker, not that TaiCOL spells anything a particular way.
    const [toad] = await sql`
      select common_name_zh as zh from taxa where id = 28758`;
    assert.ok(toad?.zh, "expected taxon 28758 in the checklist");
    for (const kind of ["roadkill", "wildlife"])
      assert.deepEqual(chosenSpecies(await html(`/report/${kind}?taxonId=28758`)), [toad.zh], kind);
  });

  test("a species with no records prefills too", async () => {
    // The case the map's named-taxon lookup cannot serve, and the one the link
    // exists for: the empty species page invites the first report of it.
    const [none] = await sql`
      select t.id, t.common_name_zh as zh from taxa t
        left join species_report_stats s on s.taxon_id = t.id
       where s.taxon_id is null and t.is_in_taiwan
         and t.taxon_status = 'accepted' and t.kingdom = 'Animalia'
         and t.rank = 'Species' and t.common_name_zh is not null
       limit 1`;
    assert.ok(none, "expected a species with no records");
    assert.deepEqual(chosenSpecies(await html(`/report/wildlife?taxonId=${none.id}`)), [none.zh]);
  });

  test("the invasive page does not prefill a native animal", async () => {
    // It would be sent as the species, and the server refuses a native animal
    // on this page — and the offline queue treats a refusal as final.
    assert.deepEqual(chosenSpecies(await html("/report/invasive?taxonId=28758")), []);
    const [lizard] = await sql`
      select id, common_name_zh as zh from taxa where taicol_id = 't0029144'`;
    assert.deepEqual(
      chosenSpecies(await html(`/report/invasive?taxonId=${lizard.id}`)),
      [lizard.zh],
      "an invasive animal is prefilled there",
    );
  });

  test("a bad or unknown taxonId is ignored rather than erroring", async () => {
    for (const bad of ["abc", "-1", "99999999", ""]) {
      const res = await fetch(`${BASE_URL}/report/wildlife?taxonId=${bad}`);
      assert.equal(res.status, 200, `?taxonId=${bad} is not an error`);
      assert.deepEqual(
        chosenSpecies(await res.text()),
        [],
        `?taxonId=${bad} must leave the picker empty`,
      );
    }
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

  test("both cards say what happens next, for the page the report came from", () => {
    // The sent card and the saved card share one block, so a report saved
    // with no signal is told the same things as one that was sent.
    assert.match(FORM, /const afterwards = \(\) => \(/);
    assert.equal((FORM.match(/\{afterwards\(\)\}/g) ?? []).length, 2);
    assert.match(FORM, /page === "invasive" && <div className="mt-3">\{invasiveNext\(\)\}/);
    assert.match(FORM, /page === "roadkill" && <div className="mt-4">\{taironNote\(\)\}/);
    // And an invasive report says it has not been checked, on both.
    assert.equal((FORM.match(/\{unverified && unverifiedTag\(\)\}/g) ?? []).length, 2);
  });
});

describe("the roadkill receipt's link to 路殺社", () => {
  const catalogue = (l) =>
    JSON.parse(readFileSync(join(import.meta.dirname, "..", "messages", `${l}.json`), "utf8"));

  test("is a link to TaiRON's own site, and nothing is sent or stored", () => {
    assert.match(FORM, /const TAIRON_URL = "https:\/\/roadkill\.tw";/);
    const note = FORM.slice(FORM.indexOf("const taironNote"), FORM.indexOf("const unverifiedTag"));
    assert.match(note, /href=\{TAIRON_URL\}/);
    assert.match(note, /target="_blank"/);
    assert.match(note, /rel="noopener noreferrer"/);
    // A link only: nothing posts to TaiRON and no flag is written.
    assert.doesNotMatch(FORM, /fetch\([^)]*roadkill\.tw/);
    assert.doesNotMatch(FORM, /tairon[A-Z]?\w*:\s*true/);
  });

  test("says the reporter needs their own TaiRON account", () => {
    assert.match(catalogue("en").report.receipt.taironBody, /your own TaiRON account/);
    assert.match(catalogue("zh-TW").report.receipt.taironBody, /自己的 TaiRON 帳號/);
  });
});

describe("the invasive receipt", () => {
  const catalogue = (l) =>
    JSON.parse(readFileSync(join(import.meta.dirname, "..", "messages", `${l}.json`), "utf8"));

  test("says it is recorded, checked, and that nobody is sent", () => {
    const en = catalogue("en").report.receipt.invasiveNextBody;
    const zh = catalogue("zh-TW").report.receipt.invasiveNextBody;
    assert.match(en, /keep the record/);
    assert.match(en, /moderator will check/);
    assert.match(en, /Nobody is sent out/);
    assert.match(en, /not yet verified/);
    assert.match(zh, /保存這筆紀錄/);
    assert.match(zh, /查證物種/);
    assert.match(zh, /不會有人前往現場/);
    assert.match(zh, /尚未查證/);
  });

  test("never suggests catching, moving or harming the animal", () => {
    // A reporter told to catch a "sacred ibis" that is a protected egret has
    // been told to by us. Checked over every sentence the invasive page shows.
    const HARM = /\b(catch|captur|trap|kill|remov|mov(e|ing) it|relocat|cull|harm|handle)\w*/i;
    const HARM_ZH = /捕|抓|撲殺|移除|移走|宰|殺|誘捕|驅離/;
    for (const l of ["en", "zh-TW"]) {
      const r = catalogue(l).report;
      for (const text of [
        r.receipt.invasiveNextTitle,
        r.receipt.invasiveNextBody,
        r.receipt.notVerified,
        r.speciesUnsureHintInvasive,
        r.notOnListLead,
        r.notOnListLink,
        r.pages.invasive,
      ]) {
        assert.doesNotMatch(text, l === "en" ? HARM : HARM_ZH, `${l}: "${text}"`);
      }
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

    const page = await html("/report/wildlife");
    assert.ok(/id="submit-blocker"/.test(page), "the blocker must be rendered before anything is chosen");
    assert.match(page, /aria-describedby="submit-blocker"/);
  });

  test("their spacing comes from a group, not a negative margin", () => {
    // `-mb-1` cancelled part of the parent's spacing, so the gap between the
    // two changed whenever the page's spacing scale did — a relationship
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
