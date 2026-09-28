import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CATEGORIES,
  REPORT_GROUP_KEYS,
  categoriesIn,
} from "@conservation/shared";

/**
 * Claims the site is not entitled to make.
 *
 * Every sentence guarded here was true of a plan, or of a previous version of
 * the project, and became false without anyone editing it. That is the failure
 * mode: copy does not rot loudly. No test fails, no type breaks, the page still
 * returns 200, and the words quietly describe a different site from the one
 * being served — for months, on the front page.
 *
 *  - **GBIF.** `scripts/export-dwca.ts` writes a local archive and its publisher
 *    fields are placeholders. Nothing has ever been sent. Three strings say we
 *    *plan* to publish and are right; the two that used the present tense are
 *    what this file exists for. The word "plan" is load-bearing, so the pattern
 *    catches the present-tense phrasings specifically rather than the acronym.
 *  - **Retired categories.** 環境通報 / "environmental reports" and 生態通報 are
 *    from two renames ago. No report form offers them, and no record carries
 *    one.
 *  - **`errors.backHome`** labels a `<Link href="/">` on both error pages. It
 *    said "Back to map".
 *  - **`app/manifest.ts`** cannot read the catalogues — it is served once for the
 *    whole site, before a locale exists — so it holds its own copy of the name
 *    and the description, and that copy was three years of renames out of date.
 *    A duplicate that nothing checks is a duplicate that drifts.
 *  - **Sentences that contradicted each other.** An audit of every page in
 *    September 2026 found the site saying two things at once: the AI was "not
 *    switched on yet" on one page while another said photos were sent to it; a
 *    named report was "published as you gave it" on the home page while the
 *    form held any report without a photo for a person to check; a list of
 *    2011–2017 records was headed "Recent reports"; a sentence promised
 *    publication "under your terms", and there are no terms; four report types
 *    were listed above a form that offers three; and a link to the blurring
 *    explanation was labelled "About the project". Each is pinned below against
 *    the code or the file that makes it true, so it is the code changing, not a
 *    reader, that tells us the words have to.
 *
 *    Removing "not switched on" was not the end of the first one. /attribution
 *    and /about then said the model identifies unnamed reports while the form,
 *    the receipt and the record page still said a person did it "by hand" —
 *    and the classifier publishes those reports with no person involved. A
 *    contradiction is two sentences, so the test pins both.
 *
 * This guards facts, not phrasing. A rewrite that stays true passes; changing
 * one of these assertions to accommodate new copy means the new copy is false.
 */
const WEB = new URL("..", import.meta.url).pathname;
const MESSAGES = join(WEB, "messages");
const locales = readdirSync(MESSAGES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(".json", ""));
const catalogues = Object.fromEntries(
  locales.map((l) => [
    l,
    JSON.parse(readFileSync(join(MESSAGES, `${l}.json`), "utf8")),
  ]),
);

/** Every leaf value, as [dotted.key, string] pairs. */
const entries = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? entries(v, `${prefix}${k}.`)
      : [[`${prefix}${k}`, String(v)]],
  );

const UNTRUE =
  /are published back to GBIF|publishes new reports back|environmental reports|環境通報|生態通報/;

describe("the catalogues claim nothing that is not true", () => {
  test("no string says records already reach GBIF, or offers a retired category", () => {
    const offenders = [];
    for (const l of locales)
      for (const [k, v] of entries(catalogues[l]))
        if (UNTRUE.test(v)) offenders.push(`${l}: ${k} — ${v}`);
    assert.deepEqual(
      offenders,
      [],
      "these strings describe a site we do not run",
    );
  });

  test("the error pages' home link is labelled as the home page", () => {
    // Both app/[locale]/error.tsx and not-found.tsx put this on href="/".
    for (const l of locales) {
      const label = catalogues[l].errors.backHome;
      assert.doesNotMatch(
        label,
        /map|地圖/i,
        `${l}: errors.backHome is "${label}", but the link goes to the front page`,
      );
    }
  });
});

const read = (p) => readFileSync(join(WEB, p), "utf8");
/** Every source file under a directory, recursively. */
function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(tsx?|mjs)$/.test(name)) yield p;
  }
}
/**
 * A source file with its comments removed. Several of the files checked here
 * explain in a comment the very call the test looks for, so matching the raw
 * text passes with the call deleted.
 */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
/** Every string in a locale that matches, as "locale: key — value". */
const matching = (pattern) =>
  locales.flatMap((l) =>
    entries(catalogues[l])
      .filter(([, v]) => pattern.test(v))
      .map(([k, v]) => `${l}: ${k} — ${v}`),
  );

describe("the copy does not contradict itself", () => {
  test("nothing says the identification model is off while a job runs it", () => {
    // /attribution said "It is not switched on yet" while /privacy said photos
    // are sent to it. The cron in vercel.json is what decides which is true.
    const vercel = JSON.parse(read("vercel.json"));
    assert.ok(
      vercel.crons?.some((c) => c.path === "/api/jobs/classify"),
      "the classifier is no longer scheduled — /attribution and /privacy say photos are sent to it; say otherwise there too, then change this test",
    );
    assert.deepEqual(matching(/not switched on|尚未啟用/i), []);
    // And the page that lists who receives data names the service that does.
    for (const l of locales)
      assert.match(catalogues[l].privacy.thirdPartyBody, /Modal/);
  });

  test("nothing says a person identifies the reports the classifier publishes", () => {
    // A report with a photo and no species name is held `pending` and queued
    // for the classifier, and the classifier is what publishes it: under the
    // species it names when it is confident, and otherwise unidentified at the
    // blurred precision. No person is involved in either. The form's "I'm not
    // sure" hint, the receipt after sending and the record page's receipt all
    // said a person identified it "by hand" while /attribution and /about said
    // the model did — so the site contradicted itself on exactly the point the
    // previous test was written for, and that test, which only looked for
    // "not switched on", passed.
    const classify = code("app/api/jobs/classify/route.ts");
    assert.match(
      classify,
      /precision_override = \$\{UNIDENTIFIED_PRECISION\},\s*status = case when status = 'pending' then 'published'/,
      "the classifier no longer publishes the reports it cannot name — the form and the receipt say it does; say otherwise there too, then change this test",
    );
    const PERSON =
      /by hand|a person identifies|someone has to identify|until someone identifies|人工處理|由人確認物種|等到有人辨識/i;
    assert.deepEqual(matching(PERSON), []);
    // The lab puts its own copy of the receipt in front of the team.
    assert.doesNotMatch(read("lib/lab/copy.ts"), PERSON);

    // And the sentences a reporter reads at the moment it matters say what
    // does happen: the model tries, and failing that the record is public but
    // blurred.
    for (const key of ["speciesUnsureHint", "receipt.heldForIdentification"]) {
      const en = key.split(".").reduce((o, k) => o[k], catalogues.en.report);
      const zh = key.split(".").reduce((o, k) => o[k], catalogues["zh-TW"].report);
      assert.match(en, /identification model/, `en report.${key}`);
      assert.match(en, /blurred/, `en report.${key}`);
      assert.match(zh, /辨識模型/, `zh-TW report.${key}`);
      assert.match(zh, /模糊/, `zh-TW report.${key}`);
    }
  });

  test("a report without a photo is described as held, because it is", () => {
    // The home page's "how it works" said a named report is "published as you
    // gave it"; screenSubmission() holds one with no photo for a person — but
    // only in a category whose `classifiable` flag is set, which is the whole
    // of the condition. A category added without it would publish photo-less
    // reports unseen while /about says every one is checked.
    assert.match(
      code("lib/abuse.ts"),
      /CATEGORIES\[input\.category\]\.classifiable && input\.photoCount === 0/,
      "reports without a photo are no longer held — about.how2Body says they are",
    );
    const unheld = Object.entries(CATEGORIES)
      .filter(([, c]) => !c.classifiable)
      .map(([k]) => k);
    assert.deepEqual(
      unheld,
      [],
      "these categories publish a report with no photo unseen — about.how2Body says a person checks every one",
    );
    assert.deepEqual(matching(/published as you gave it|照你寫的公開/), []);
    assert.match(catalogues.en.about.how2Body, /without a photo/);
    assert.match(catalogues["zh-TW"].about.how2Body, /沒有照片/);
  });

  test("/about names the 'not sure' choice by the label the form gives it", () => {
    // It told Chinese readers to choose 「不確定」; the control says
    // 「我不確定那是什麼」, and a reader looking for the first finds nothing.
    const zh = catalogues["zh-TW"];
    for (const [, quoted] of zh.about.how2Body.matchAll(/「([^」]+)」/g))
      assert.equal(quoted, zh.report.speciesUnsure, "how2Body quotes a label the form does not use");
  });

  test("a chart's busiest month is not called most of the records", () => {
    // MonthlyChart names counts.indexOf(max): the month with the most records,
    // which holds more than half of them for about one species in twenty.
    // "412 records, most of them in April" was false on the other nineteen.
    assert.match(code("components/species/MonthlyChart.tsx"), /counts\.indexOf\(max\)/);
    for (const l of locales)
      assert.doesNotMatch(
        catalogues[l].species.seasonalityHint,
        /most of them|majority|大部分|大多數|過半/i,
        `${l}: species.seasonalityHint calls the peak month a majority`,
      );
  });

  test("nothing calls the records recent", () => {
    // /reports was "Recent reports" above a first row dated 2017-12-31. Its lede
    // now states the span from the data instead.
    assert.deepEqual(matching(/\brecent reports\b|最近的通報/i), []);
  });

  test("nothing refers to terms that do not exist", () => {
    // "under your terms", on the home page. There has never been a terms page.
    if (existsSync(join(WEB, "app/[locale]/(site)/terms/page.tsx"))) return;
    assert.deepEqual(matching(/your terms|使用條款|服務條款/i), []);
  });

  test("report types are listed as the form offers them", () => {
    // "Roadkill, invasive species, injured wildlife or a sighting" above a form
    // with three choices: injured is part of the roadkill choice, not its own.
    assert.equal(REPORT_GROUP_KEYS.length, 3);
    assert.ok(categoriesIn("roadkill").includes("injured"));
    assert.deepEqual(
      matching(/injured wildlife or|受傷野生動物或|roadkill, an injured animal|路殺、受傷/i),
      [],
    );
  });

  test("why a record is blurred names protection by law, as the database does", () => {
    // precision_from_taxon() blurs a species protected by law to 10 km even
    // when TaiCOL gives it no sensitivity rating. That is 1,606 of the 7,170
    // blurred public records locally — and /stats, /season and /about each
    // said the reason was a TaiCOL rating or a missing identification. No
    // blur was loosened; the trust page just understated the protection.
    const MIGRATIONS = join(WEB, "..", "..", "supabase", "migrations");
    const defining = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
      .filter((s) => /function precision_from_taxon\b/.test(s))
      .at(-1);
    assert.ok(defining, "precision_from_taxon() is defined in no migration");
    if (!/when prot is not null and prot <> '' then 'coarse_10km'/.test(defining)) return;
    for (const key of ["statsPage.coverageBody", "season.obscuredNote", "about.privacyBody"]) {
      const get = (l) => key.split(".").reduce((o, k) => o[k], catalogues[l]);
      assert.match(get("en"), /protected by law/, `en ${key}`);
      assert.match(get("zh-TW"), /法定保育類/, `zh-TW ${key}`);
    }
  });

  test("why a record is blurred names the Red List, once the database does", () => {
    // 0021 blurs the Red List's threatened categories. The pages that list why
    // a record is blurred must say so, or a reader who checks a Vulnerable
    // frog's rating and protection finds neither and concludes the map is
    // hiding things at random.
    const MIGRATIONS = join(WEB, "..", "..", "supabase", "migrations");
    const live = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .some((f) => /precision_from_redlist\(cur\.redlist\)/.test(readFileSync(join(MIGRATIONS, f), "utf8")));
    if (!live) return;
    for (const key of ["statsPage.coverageBody", "season.obscuredNote", "about.privacyBody", "list.obscuredLegend"]) {
      const get = (l) => key.split(".").reduce((o, k) => o[k], catalogues[l]);
      assert.match(get("en"), /threatened/, `en ${key}`);
      assert.match(get("zh-TW"), /受威脅/, `zh-TW ${key}`);
    }
  });

  test("the link to the blurring explanation is labelled as that explanation", () => {
    // It said "About the project" and went to the top of /about. It now goes to
    // the section, and carries the section's own heading.
    for (const l of locales)
      assert.equal(
        catalogues[l].statsPage.howObscuringWorks,
        catalogues[l].about.privacyTitle,
        `${l}: the /stats link and the /about heading it lands on differ`,
      );
    assert.match(read("app/[locale]/(site)/stats/page.tsx"), /href="\/about#blurred"/);
    assert.match(
      read("app/[locale]/(site)/about/page.tsx"),
      /id="blurred" title=\{t\("privacyTitle"\)\}/,
    );
  });
});

describe("the privacy page names what sees a reporter", () => {
  // It lists what the site collects and who receives it, and it left out the
  // two things every reporter passes through: Cloudflare Turnstile, which gets
  // their IP address, and the rate limit, which counts reports per IP address
  // — or per account, for a reporter who is signed in.
  const page = read("app/[locale]/(site)/privacy/page.tsx");

  test("Turnstile, while the report route checks it", () => {
    if (!/verifyTurnstile\(/.test(read("app/api/reports/route.ts"))) return;
    // Named in the list of services, and explained — what it is and why — in
    // a section of its own. A name in a list tells nobody what it does.
    for (const l of locales) {
      assert.match(catalogues[l].privacy.thirdPartyBody, /Cloudflare Turnstile/);
      assert.match(catalogues[l].privacy.turnstileBody, /Cloudflare Turnstile/);
    }
    assert.match(page, /"turnstileBody"/, "the section is written but not rendered");
  });

  test("the per-address count, while the rate limit keeps one", () => {
    // The sentence about the count itself. /IP/ alone was satisfied by the
    // Turnstile sentence beside it, so deleting this one still passed.
    const route = code("app/api/reports/route.ts");
    if (!/`ip:\$\{ip\}`/.test(route)) return;
    for (const l of locales)
      assert.match(
        catalogues[l].privacy.turnstileBody,
        /count how many reports each IP address|計算每個 IP 位址.*最近送出了幾筆/,
        `${l}: privacy.turnstileBody no longer says reports are counted per address`,
      );
    // A signed-in reporter is counted by account, not by address.
    if (!/`user:\$\{reporterId\}`/.test(route)) return;
    for (const l of locales)
      assert.match(
        catalogues[l].privacy.turnstileBody,
        /each account if you are signed in|登入時則是每個帳號/,
        `${l}: privacy.turnstileBody says the count is per address for everyone`,
      );
  });
});

describe("house style the catalogues can check", () => {
  test("no English count is a number beside a fixed plural noun", () => {
    // "1 records" in the species directory, "1 reports waiting to send" on the
    // report page, "7169 locations blurred". A count belongs inside an ICU
    // plural, where both the noun and the number's formatting follow it.
    //
    // One word is allowed between them ("{n} public records"), and a bare
    // count followed by a plural verb ("{obscured} are shown") is the same
    // defect without a noun.
    const offenders = entries(catalogues.en)
      .filter(
        ([, v]) =>
          /\{\w+(?:, number)?\}\s+(?:[a-z]+\s+)?(?:records?|reports?|locations?)\b/.test(v) ||
          /\{\w+(?:, number)?\}\s+(?:are|were|have)\b/.test(v),
      )
      .map(([k, v]) => `${k} — ${v}`);
    assert.deepEqual(offenders, []);
  });

  test("a plural is handed a number, not a formatted string", () => {
    // intl-messageformat picks a plural form by subtracting the offset from the
    // value, and "1,234" - 0 is NaN: the lab map rendered every cell of a
    // thousand records or more as "NaN records here" / "此區 非數值 筆紀錄".
    // The message formats the number itself, for the reader's locale.
    const plurals = new Map(); // last key segment -> plural argument names
    for (const [k, v] of entries(catalogues.en))
      for (const [, arg] of v.matchAll(/\{(\w+), (?:plural|selectordinal),/g)) {
        const leaf = k.split(".").pop();
        plurals.set(leaf, new Set([...(plurals.get(leaf) ?? []), arg]));
      }
    const offenders = [];
    for (const dir of ["app", "components", "lib"])
      for (const file of sources(join(WEB, dir))) {
        const src = readFileSync(file, "utf8");
        for (const [, key, args] of src.matchAll(
          /\b\w+\(\s*"([\w.]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g,
        )) {
          const argNames = plurals.get(key.split(".").pop());
          if (!argNames) continue;
          for (const arg of argNames)
            if (
              new RegExp(`\\b${arg}\\s*:\\s*(?:n\\(|String\\(|[^,}]*\\.toLocaleString\\()`).test(args)
            )
              offenders.push(`${file.slice(WEB.length)}: ${key} — ${arg}`);
        }
      }
    assert.deepEqual(offenders, [], "pass the number; the message formats it");
  });

  test("the Chinese addresses the reader as 你, not 您", () => {
    // docs/redesign/zh-tw-review.md. /privacy alone said 您, so the one page
    // that is about the reader's own rights sounded like a different site.
    const offenders = entries(catalogues["zh-TW"])
      .filter(([, v]) => v.includes("您"))
      .map(([k]) => k);
    assert.deepEqual(offenders, []);
  });
});

describe("one species count", () => {
  /*
   * /stats and /season said 506 species while the directory listed 501, and the
   * map's header agreed with neither page it linked to. They were two queries:
   * `count(distinct taxon_id)` over the public view, and the directory's own,
   * which leaves out names that do not apply in Taiwan. Every page now asks
   * recordedSpeciesCount(), which asks the directory.
   *
   * Checked in the source rather than by comparing rendered pages. Each page is
   * cached on its own timer, and the suite commits reports while it runs, so
   * two correct pages can briefly disagree by one. And CI's fixture holds none
   * of the names the two queries disagree about, so there a rendered comparison
   * would pass with either query. What does not vary is which function a page
   * calls.
   */
  const KNOWN = new Map([
    // Outside the change that unified the others, each with its one-line fix:
    // use recordedSpeciesCount() from lib/stats.ts. Remove the entry with it.
    ["app/[locale]/page.tsx", "the home page's '{count} species on record' row"],
    ["app/api/health/route.ts", "the count the parent site reads from /api/health"],
  ]);

  test("no page counts species with a query of its own", () => {
    const offenders = [];
    for (const dir of ["app", "lib", "components"])
      for (const file of sources(join(WEB, dir))) {
        const rel = file.slice(WEB.length);
        if (KNOWN.has(rel)) continue;
        // Code, not comments: lib/stats.ts explains the old query by name.
        const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
        if (/count\(\s*distinct\s+(?:\w+\.)?taxon_id/i.test(code)) offenders.push(rel);
      }
    assert.deepEqual(offenders, [], "use recordedSpeciesCount() from lib/stats.ts");
  });

  test("the pages that state it ask the one function", () => {
    // In code: /stats and /map each explain recordedSpeciesCount() in a
    // comment, which was enough to pass with the call itself deleted.
    for (const p of [
      "app/[locale]/(site)/stats/page.tsx",
      "app/[locale]/(site)/season/page.tsx",
      "app/[locale]/map/page.tsx",
    ])
      assert.match(code(p), /recordedSpeciesCount\(\)/, p);
    assert.match(code("lib/stats.ts"), /countSpecies\(\{ filter: "recorded" \}\)/);
  });

  test("/season divides that count by one of the same kind", () => {
    // The directory counts species and subspecies rows alike, and /season set
    // that over the checklist's species rows alone: locally 328 species plus
    // 172 subspecies, over species only. The denominator now goes through the
    // same speciesWhere() with only the filter changed, so the two sides count
    // the same kind of row, and the label says what that kind is.
    const season = code("app/[locale]/(site)/season/page.tsx");
    assert.match(season, /checklistAnimalTaxaCount\(\)/);
    assert.match(
      code("lib/stats.ts"),
      /countSpecies\(\{ filter: "all", kingdom: "Animalia" \}\)/,
    );
    assert.doesNotMatch(
      code("lib/coverage.ts"),
      /from taxa/,
      "lib/coverage.ts counts checklist taxa with a rule of its own again",
    );
    if (/t\.rank in \('Species','Subspecies'\)/.test(code("lib/species.ts"))) {
      assert.match(catalogues.en.season.speciesCovered, /subspecies/);
      assert.match(catalogues["zh-TW"].season.speciesCovered, /亞種/);
    }
  });
});

describe("the manifest's hand-copied strings are current", () => {
  const manifest = readFileSync(join(WEB, "app/manifest.ts"), "utf8");

  test("it carries no retired name and no retired category", () => {
    for (const dead of ["生態守望", "環境通報"])
      assert.ok(
        !manifest.includes(dead),
        `app/manifest.ts still says ${dead}`,
      );
  });

  test("its description is still both halves of site.description", () => {
    // Not a spelling check: this is the assertion that catches the copy
    // drifting the next time the catalogues are edited and this file is not.
    for (const l of locales)
      assert.ok(
        manifest.includes(catalogues[l].site.description),
        `app/manifest.ts does not contain the ${l} site.description`,
      );
  });
});
