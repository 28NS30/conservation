/**
 * A batch of small things a reader would notice, each held where it is decided.
 *
 *   node --test test/small-fixes.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { speciesDescription } from "../lib/speciesMeta.ts";
import { BASE_URL, sql } from "./helpers.mjs";

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const catalogue = (l) => JSON.parse(read("messages", `${l}.json`));
const up = async () => Boolean(await fetch(BASE_URL).catch(() => null));
after(() => sql.end());

describe("fields a phone does not zoom into", () => {
  // iOS Safari zooms the page into a focused field set under 16px.
  const classesOf = (src, marker) => {
    const at = src.indexOf(marker);
    assert.ok(at >= 0, `${marker} not found`);
    return /className="([^"]+)"/.exec(src.slice(at))?.[1] ?? "";
  };

  test("the map's species filter and year selects", () => {
    const src = read("components", "map", "MapFilters.tsx");
    const input = classesOf(src, 'aria-label={t("map.filterSpecies")}');
    assert.match(input, /(^| )text-base( |$)/);
    assert.match(input, /(^| )sm:text-xs( |$)/);
    for (const label of ['aria-label={t("map.fromYear")}', 'aria-label={t("map.toYear")}']) {
      const select = classesOf(src, label);
      assert.match(select, /(^| )text-base( |$)/, label);
    }
  });

  test("the species directory's search box", () => {
    const src = read("components", "species", "SpeciesSearch.tsx");
    const input = classesOf(src, 'type="search"');
    assert.match(input, /(^| )text-base( |$)/);
  });
});

describe("a species page's description", () => {
  const translators = ["zh-TW", "en"].map((locale) =>
    createTranslator({ locale, messages: catalogue(locale), namespace: "species" }),
  );
  const describe_ = (s, name = "石虎") =>
    translators.map((t) => {
      const d = speciesDescription(s, name);
      return t(d.key, d.values);
    });

  test("a withheld species is described without a count, even a true one", () => {
    // reports_public holds none of its records, so its count is always 0.
    for (const reportCount of [0, 12]) {
      const [zh, en] = describe_({ sensitivity: "座標不開放", reportCount });
      for (const text of [zh, en]) {
        assert.doesNotMatch(text, /\d/, text);
        assert.match(text, /石虎/);
      }
      assert.match(zh, /座標不予公開/);
      assert.match(en, /not published/);
    }
  });

  test("a species nobody has reported is never '0 筆'", () => {
    const [zh, en] = describe_({ sensitivity: null, reportCount: 0 });
    assert.doesNotMatch(zh, /0\s*筆/);
    assert.doesNotMatch(en, /\b0 records?\b/);
    assert.match(zh, /還沒有人通報過/);
  });

  test("a recorded species keeps its count", () => {
    const [zh, en] = describe_({ sensitivity: "輕度", reportCount: 1234 });
    assert.match(zh, /1,234 筆/);
    assert.match(en, /1,234 records/);
    assert.match(describe_({ sensitivity: null, reportCount: 1 })[1], /\(1 record\)/);
  });

  test("the page asks it", () => {
    const page = read("app", "[locale]", "(site)", "species", "[id]", "page.tsx");
    assert.match(page, /speciesDescription\(s, name\)/);
    assert.doesNotMatch(page, /t\("metaDescription", \{ name, count/);
  });
});

describe("the form's words", () => {
  const zh = catalogue("zh-TW");
  const en = catalogue("en");
  const values = (o) => Object.values(o).flatMap((v) => (v && typeof v === "object" ? values(v) : [String(v)]));

  test("Taiwan is 臺灣 everywhere in the Chinese", () => {
    // 台 stays where it is a measure word (這台裝置); the place is 臺灣.
    assert.deepEqual(values(zh).filter((v) => v.includes("台灣")), []);
  });

  test("an unnamed animal is 尚未辨識, the record page's word, in every form string", () => {
    assert.equal(zh.detail.notYetIdentified, "尚未辨識");
    assert.deepEqual(values(zh).filter((v) => v.includes("未鑑定")), []);
    for (const k of ["speciesUnsureHint", "speciesUnsureHintInvasive"])
      assert.match(zh.report[k], /尚未辨識/, k);
    assert.match(zh.report.receipt.heldForIdentification, /尚未辨識/);
  });

  test("the model is introduced as AI where the form first names it", () => {
    for (const text of [
      zh.report.speciesUnsureHint,
      zh.report.receipt.heldForIdentification,
      zh.report.testMode.body,
      zh.detail.receipt.body,
    ]) {
      const first = text.indexOf("辨識模型");
      assert.equal(text.slice(first - 3, first), "AI ", text);
    }
  });

  test("the English asks the time as a question, and says where the bot check is", () => {
    assert.equal(en.report.observedAt, "When did you see it?");
    assert.equal(en.report.needChallenge, "Complete the bot check at the end of the form");
  });
});

describe("the yearly chart", () => {
  test("a year with no records is a zero, not a missing column", async () => {
    const { everyYear } = await import("../lib/yearSeries.ts");
    assert.deepEqual(
      everyYear([{ year: 2016, n: 5 }, { year: 2017, n: 3 }, { year: 2026, n: 2 }]).map((y) => [y.year, y.n]),
      [[2016, 5], [2017, 3], ...[2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y) => [y, 0]), [2026, 2]],
    );
    assert.deepEqual(everyYear([]), []);
    assert.deepEqual(everyYear([{ year: 2017, n: 1 }]), [{ year: 2017, n: 1 }]);
  });

  test("the axis prints two digits, and the table the whole year", async () => {
    // Sixteen columns on a phone are about 16px each, and "2011" at 9px is
    // about 21px: cut to fit, every year read "20…".
    const { yearAxis } = await import("../lib/yearSeries.ts");
    assert.equal(yearAxis(2011), "’11");
    assert.equal(yearAxis(2005), "’05");
    assert.match(
      read("app", "[locale]", "(site)", "stats", "page.tsx"),
      /key: yearAxis\(y\.year\), label: String\(y\.year\)/,
    );
  });

  test("the query is filled before the page draws it, and the page says why", () => {
    assert.match(read("lib", "stats.ts"), /return everyYear\(rows\)/);
    assert.match(read("app", "[locale]", "(site)", "stats", "page.tsx"), /t\("byYearSource"\)/);
    assert.match(catalogue("zh-TW").statsPage.byYearSource, /2017/);
    assert.match(catalogue("en").statsPage.byYearSource, /2017/);
  });
});

describe("the report form's fields say what describes them", () => {
  test("as rendered: the email autocompletes, and the email and photo inputs name their help", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const html = await (await fetch(`${BASE_URL}/report/roadkill`)).text();
    const tag = (id) => new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
    const email = tag("email");
    assert.match(email, /autoComplete="email"|autocomplete="email"/i);
    assert.match(email, /aria-describedby="email-help"/);
    assert.match(html, /id="email-help"/);
    const file = /<input[^>]*type="file"[^>]*>/.exec(html)?.[0] ?? "";
    assert.match(file, /aria-describedby="photo-help"/);
    assert.match(html, /id="photo-help"/);
    // No error is showing, so the time field names nothing.
    assert.doesNotMatch(tag("observedAt"), /aria-describedby/);
  });

  test("and an error, once shown, is one of the lines described", () => {
    const form = read("components", "report", "ReportForm.tsx");
    assert.match(form, /<p id=\{`\$\{slot\}-error`\} role="alert"/);
    assert.match(form, /aria-describedby=\{describedBy\(errorId\("time"\)\)\}/);
    assert.match(form, /aria-describedby=\{describedBy\("email-help", errorId\("contact"\)\)\}/);
    assert.match(form, /errorId\("photo"\)/);
  });
});

describe("what a shared link's preview says", () => {
  const meta = (html, property) =>
    [...html.matchAll(new RegExp(`<meta property="${property}" content="([^"]*)"`, "g"))].map((m) => m[1]);

  test("every page names the site, its language and its type", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    for (const [path, locale, other, name] of [
      ["/about", "zh_TW", "en_GB", catalogue("zh-TW").site.title],
      ["/en/about", "en_GB", "zh_TW", catalogue("en").site.title],
    ]) {
      const html = await (await fetch(`${BASE_URL}${path}`)).text();
      assert.deepEqual(meta(html, "og:site_name"), [name], path);
      assert.deepEqual(meta(html, "og:locale"), [locale], path);
      assert.deepEqual(meta(html, "og:locale:alternate"), [other], path);
      assert.deepEqual(meta(html, "og:type"), ["website"], path);
    }
  });

  test("the site card's alt text is in the page's language", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    for (const [path, l] of [["/", "zh-TW"], ["/en", "en"]]) {
      const html = await (await fetch(`${BASE_URL}${path}`)).text();
      const { title, tagline } = catalogue(l).site;
      assert.deepEqual(meta(html, "og:image:alt"), [`${title} · ${tagline}`], path);
    }
  });

  test("a species card's alt text names the species", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const [s] = await sql`
      select t.id, t.common_name_zh as zh from taxa t
        join species_report_stats s on s.taxon_id = t.id
       where t.common_name_zh is not null
       order by s.report_count desc limit 1`;
    if (!s) return t.skip("no recorded species in this database");
    const html = await (await fetch(`${BASE_URL}/species/${s.id}`)).text();
    const [alt] = meta(html, "og:image:alt");
    assert.ok(alt?.startsWith(s.zh), `alt is ${alt}`);
    assert.doesNotMatch(alt, /Species record/);
  });
});
