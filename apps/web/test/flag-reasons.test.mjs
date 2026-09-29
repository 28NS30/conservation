/**
 * Why a report was held, as the moderation queue says it.
 *
 * `reports.flagged_reason` is stored as an English sentence and the queue
 * showed it as stored, so the Chinese site told moderators "no photo on a
 * category that expects one". lib/report/flagReasons.ts matches each sentence
 * to a message. What goes wrong quietly is a new reason added to a writer and
 * not to that file: it would show in English again, which is safe but is the
 * bug this fixed. So every reason-shaped sentence in the four writers must be
 * one it knows.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flagReason } from "../lib/report/flagReasons.ts";

const WEB = join(import.meta.dirname, "..");
const WRITERS = [
  "lib/abuse.ts",
  "lib/report/classifyPolicy.ts",
  "lib/report/classifyWorker.ts",
  "lib/report/classifyEvidence.ts",
];

/**
 * The sentences a writer can store, read from where it stores them: the
 * `flagged_reason = …` of an update, the policy's `reason` (a `reason:` field
 * or a `const reason =` chain), and the abuse screen's `return`s. Each ${...}
 * becomes a stand-in name. Errors thrown along the way are not reasons and
 * are not read.
 */
function reasonsIn(src) {
  const segments = [
    ...[...src.matchAll(/flagged_reason = \$\{([\s\S]*?)\}\s*\n/g)].map((m) => m[1]),
    ...[...src.matchAll(/flagged_reason = ('[^']+')/g)].map((m) => m[1]),
    ...[...src.matchAll(/const reason =([\s\S]*?);\n/g)].map((m) => m[1]),
    ...[...src.matchAll(/reason: ("[^"]+"|`[^`]+`)/g)].map((m) => m[1]),
    ...[...src.matchAll(/return ("[^"]+");/g)].map((m) => m[1]),
  ];
  return segments.flatMap((seg) => [
    ...[...seg.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]),
    ...[...seg.matchAll(/'([^'\n]+)'/g)].map((m) => m[1]),
    ...[...seg.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].replace(/\$\{[^}]+\}/g, "Example name")),
  ]).filter((s) => s.includes(" ")); // a sentence, not a band compared against
}

describe("every reason a writer stores", () => {
  for (const file of WRITERS) {
    test(`${file} has a message for each`, () => {
      const found = reasonsIn(readFileSync(join(WEB, file), "utf8"));
      const unknown = found.filter((s) => !flagReason(s));
      assert.deepEqual(unknown, [], "add these to lib/report/flagReasons.ts and admin.flag");
    });
  }

  test("the scan finds the reasons it is meant to", () => {
    // If the scan went blind, the test above would pass on nothing.
    const all = WRITERS.flatMap((f) => reasonsIn(readFileSync(join(WEB, f), "utf8")));
    assert.ok(all.includes("no photo on a category that expects one"));
    assert.ok(all.some((s) => s.startsWith("the model is sure of Example name")));
    assert.ok(all.length >= 12, `only ${all.length} reasons found`);
  });
});

describe("the mapping", () => {
  test("names are carried into the sentence", () => {
    assert.deepEqual(
      flagReason(
        "the model is sure of Prionailurus bengalensis, but lists Felis catus, which is blurred more strictly; a person must confirm",
      ),
      { key: "stricterSibling", values: { name: "Prionailurus bengalensis", other: "Felis catus" } },
    );
    assert.deepEqual(flagReason("the model only suggests Aves species"), {
      key: "onlySuggestsClass",
      values: { group: "Aves" },
    });
  });

  test("the fixed sentence is not mistaken for the per-class one", () => {
    assert.equal(
      flagReason("the model only suggests a species for this kind of report")?.key,
      "onlySuggests",
    );
  });

  test("a sentence nobody taught it is left alone, to be shown as stored", () => {
    assert.equal(flagReason("something new happened"), null);
  });

  test("every key has a sentence in both languages, with its names", () => {
    const keys = {
      outsideTaiwan: [], noPhoto: [], linksInNotes: [], disagrees: [], notIdentified: [],
      lowConfidence: [], onlySuggests: [], unavailable: [], suspectsInvasive: ["name"],
      mixedForms: ["name"], looksNative: ["name"], wrongModel: [], onlySuggestsClass: ["group"],
      includesInvasive: ["name"], stricterSibling: ["name", "other"],
    };
    for (const locale of ["en", "zh-TW"]) {
      const flag = JSON.parse(readFileSync(join(WEB, "messages", `${locale}.json`), "utf8")).admin.flag;
      for (const [key, names] of Object.entries(keys)) {
        assert.equal(typeof flag[key], "string", `${locale}: admin.flag.${key} is missing`);
        for (const n of names) assert.ok(flag[key].includes(`{${n}}`), `${locale}: ${key} drops {${n}}`);
      }
    }
  });

  test("the queue shows the translation, and the stored sentence when there is none", () => {
    const page = readFileSync(join(WEB, "app", "[locale]", "(site)", "admin", "page.tsx"), "utf8");
    assert.match(page, /flaggedReason=\{flagText\(r\.flagged_reason\)\}/);
    assert.match(page, /return known \? tf\(known\.key, known\.values\) : stored;/);
  });
});
