/**
 * A batch of small things a reader would notice, each held where it is decided.
 *
 *   node --test test/small-fixes.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { speciesDescription } from "../lib/speciesMeta.ts";

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const catalogue = (l) => JSON.parse(read("messages", `${l}.json`));

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
