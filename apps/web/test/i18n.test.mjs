/**
 * Translation catalogue integrity.
 *
 * The failure mode these guard against is silent: a missing key renders as the
 * raw key path ("report.submit") rather than throwing, and a forgotten string
 * leaves Chinese text sitting in the English UI. Neither breaks a build.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CATEGORY_KEYS, LOCATION_PRECISION } from "@conservation/shared";

const MESSAGES = join(import.meta.dirname, "..", "messages");
const locales = readdirSync(MESSAGES).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
const load = (l) => JSON.parse(readFileSync(join(MESSAGES, `${l}.json`), "utf8"));

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

const catalogues = Object.fromEntries(locales.map((l) => [l, load(l)]));

describe("catalogues", () => {
  test("more than one locale exists", () => {
    assert.ok(locales.length >= 2, `expected at least 2 locales, found ${locales}`);
  });

  test("every locale has exactly the same keys", () => {
    const [base, ...rest] = locales;
    const baseKeys = new Set(flatten(catalogues[base]));
    for (const l of rest) {
      const keys = new Set(flatten(catalogues[l]));
      const missing = [...baseKeys].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !baseKeys.has(k));
      assert.deepEqual(missing, [], `${l} is missing keys present in ${base}`);
      assert.deepEqual(extra, [], `${l} has keys absent from ${base}`);
    }
  });

  test("no value is empty", () => {
    for (const l of locales) {
      const walk = (o, p = "") => {
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === "object") walk(v, `${p}${k}.`);
          else assert.ok(String(v).trim().length > 0, `${l}: ${p}${k} is empty`);
        }
      };
      walk(catalogues[l]);
    }
  });
});

describe("domain keys are covered", () => {
  // packages/shared owns the category and precision keys; the catalogues own the
  // words. If someone adds a category without a label it renders as a raw key.
  test("every report category has a label in every locale", () => {
    for (const l of locales) {
      for (const k of CATEGORY_KEYS) {
        assert.ok(catalogues[l].categories?.[k], `${l} is missing categories.${k}`);
      }
    }
  });

  test("every location precision level has a label in every locale", () => {
    for (const l of locales) {
      for (const k of Object.keys(LOCATION_PRECISION)) {
        assert.ok(catalogues[l].precision?.[k], `${l} is missing precision.${k}`);
      }
    }
  });
});

describe("English catalogue carries no untranslated CJK", () => {
  // A forgotten translation is *mostly* Chinese. A deliberate citation — the
  // sensitivity ratings (輕度, 座標不開放) or 個人資料保護法 — is a few characters
  // inside an English sentence, and an English reader dealing with Taiwanese
  // regulation genuinely needs those terms. So the guard is a ratio, not a
  // presence check: it still catches an untranslated string while allowing a
  // quoted term.
  const CJK_RATIO_LIMIT = 0.3;

  test("no English value is predominantly Han characters", () => {
    const offenders = [];
    const walk = (o, p = "") => {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === "object") {
          walk(v, `${p}${k}.`);
          continue;
        }
        const text = String(v).replace(/\s/g, "");
        if (!text) continue;
        const han = (text.match(/[一-鿿]/g) ?? []).length;
        const ratio = han / text.length;
        if (ratio > CJK_RATIO_LIMIT) {
          offenders.push(`${p}${k} (${Math.round(ratio * 100)}% Han): ${v}`);
        }
      }
    };
    walk(catalogues.en);
    assert.deepEqual(offenders, [], "untranslated strings left in the English catalogue");
  });
});

describe("placeholders match across locales", () => {
  test("each key uses the same {placeholders} in every locale", () => {
    const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const [base, ...rest] = locales;
    const baseFlat = {};
    const collect = (o, target, p = "") => {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === "object") collect(v, target, `${p}${k}.`);
        else target[`${p}${k}`] = v;
      }
    };
    collect(catalogues[base], baseFlat);

    for (const l of rest) {
      const flat = {};
      collect(catalogues[l], flat);
      for (const [k, v] of Object.entries(baseFlat)) {
        // A mismatch renders a literal "{count}" to the reader.
        assert.deepEqual(placeholders(flat[k]), placeholders(v), `placeholder mismatch at ${k} (${l})`);
      }
    }
  });
});
