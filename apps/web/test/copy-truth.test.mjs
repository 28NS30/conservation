import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPORT_GROUP_KEYS, categoriesIn } from "@conservation/shared";

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

  test("a report without a photo is described as held, because it is", () => {
    // The home page's "how it works" said a named report is "published as you
    // gave it"; screenSubmission() holds one with no photo for a person.
    assert.match(
      read("lib/abuse.ts"),
      /no photo on a category that expects one/,
      "reports without a photo are no longer held — about.how2Body says they are",
    );
    assert.deepEqual(matching(/published as you gave it|照你寫的公開/), []);
    assert.match(catalogues.en.about.how2Body, /without a photo/);
    assert.match(catalogues["zh-TW"].about.how2Body, /沒有照片/);
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
  // their IP address, and the rate limit, which counts reports per IP address.
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
    if (!/`ip:\$\{ip\}`/.test(read("app/api/reports/route.ts"))) return;
    for (const l of locales) assert.match(catalogues[l].privacy.turnstileBody, /IP/);
  });
});

describe("house style the catalogues can check", () => {
  test("no English count is a number beside a fixed plural noun", () => {
    // "1 records" in the species directory, "1 reports waiting to send" on the
    // report page, "7169 locations blurred". A count belongs inside an ICU
    // plural, where both the noun and the number's formatting follow it.
    const offenders = entries(catalogues.en)
      .filter(([, v]) =>
        /\{\w+(?:, number)?\}\s+(?:records?|reports?|locations?)\b/.test(v),
      )
      .map(([k, v]) => `${k} — ${v}`);
    assert.deepEqual(offenders, []);
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

  function* sources(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) yield* sources(p);
      else if (/\.(tsx?|mjs)$/.test(name)) yield p;
    }
  }

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
    for (const p of [
      "app/[locale]/(site)/stats/page.tsx",
      "app/[locale]/(site)/season/page.tsx",
      "app/[locale]/map/page.tsx",
    ])
      assert.match(read(p), /recordedSpeciesCount\(\)/, p);
    assert.match(read("lib/stats.ts"), /countSpecies\(\{ filter: "recorded" \}\)/);
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
