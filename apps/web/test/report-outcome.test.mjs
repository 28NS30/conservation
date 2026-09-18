/**
 * What a reporter is told after pressing send.
 *
 * The defect this guards against was not a crash: the form discarded the status
 * the API returned and told everyone their report was on the map, then linked
 * to a page that only renders published records. A held report — which is most
 * of them — got a congratulation and a 404.
 *
 * So these check two things a rendering test cannot. That the mapping from the
 * server's answer to the words is total and has no case that says "published"
 * about a pending row; and that every key the mapping can name actually exists
 * in both catalogues, since next-intl renders a missing key as its own path
 * rather than throwing.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outcomeOf, receiptLinkFor } from "../lib/report/outcome.ts";

const load = (l) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "messages", `${l}.json`), "utf8"));
const catalogues = { en: load("en"), "zh-TW": load("zh-TW") };

describe("outcomeOf", () => {
  test("a published report is on the map, with a link to it", () => {
    assert.deepEqual(outcomeOf("published", false, 1), {
      title: "onMap",
      body: null,
      link: "viewRecord",
    });
  });

  test("a report awaiting identification says a person does it, and when", () => {
    assert.deepEqual(outcomeOf("pending", true, 1), {
      title: "held",
      body: "heldForIdentification",
      link: "checkStatus",
    });
  });

  test("a report held for want of a photo says so", () => {
    assert.deepEqual(outcomeOf("pending", false, 0), {
      title: "held",
      body: "heldNoPhoto",
      link: "checkStatus",
    });
  });

  test("a report held for any other reason gets the general sentence", () => {
    // A screening flag. Why it tripped is deliberately not disclosed to the
    // person who tripped it, so there is one sentence for every such case.
    assert.deepEqual(outcomeOf("pending", false, 2), {
      title: "held",
      body: "heldForReview",
      link: "checkStatus",
    });
  });

  test("nothing but `published` is ever called published", () => {
    for (const status of ["pending", "rejected", "", undefined, null, "PUBLISHED"]) {
      for (const awaiting of [true, false, undefined]) {
        for (const photos of [0, 1, 3]) {
          for (const visible of [true, false]) {
            const o = outcomeOf(status, awaiting, photos, visible);
            assert.equal(o.title, "held", `${status} must not read as published`);
            assert.notEqual(o.link, "viewRecord");
          }
        }
      }
    }
  });

  test("a published record its taxon withholds is not called published", () => {
    // TaiCOL rates some species 座標不開放. The trigger stamps `suppressed` from
    // the taxon the REPORTER chose, `reports_public` drops the row, and the
    // stored status still reads `published` — so before this case existed, the
    // one reporter who named such a species was told "it's on the map" and
    // handed a link to a 404. There are 68 such rows in the imported data.
    const o = outcomeOf("published", false, 2, false);
    assert.equal(o.title, "withheld");
    assert.equal(o.body, "withheldSpecies");
    assert.equal(o.link, null, "there is no page of either kind behind it");
    assert.notEqual(o.title, "held", "it is not waiting for anything");
  });

  test("visible defaults to true, so every other caller is unchanged", () => {
    assert.deepEqual(outcomeOf("published", false, 1), outcomeOf("published", false, 1, true));
    assert.equal(receiptLinkFor("published"), "viewRecord");
  });

  test("a link is offered only where a page exists to open", () => {
    // `/reports/{id}` renders published records from reports_public and
    // pending ones from the receipt state. Nothing else has a page, so nothing
    // else may be offered a link — that is the 404 this work removes.
    assert.equal(receiptLinkFor("published"), "viewRecord");
    assert.equal(receiptLinkFor("pending"), "checkStatus");
    for (const status of ["rejected", "archived", "", undefined, null]) {
      assert.equal(receiptLinkFor(status), null, `${status} must offer no link`);
    }
  });
});

describe("every outcome has words in both languages", () => {
  const RECEIPT_KEYS = new Set();
  for (const status of ["published", "pending", "rejected", undefined]) {
    for (const awaiting of [true, false]) {
      for (const photos of [0, 2]) {
        for (const visible of [true, false]) {
        const o = outcomeOf(status, awaiting, photos, visible);
        RECEIPT_KEYS.add(o.title);
        if (o.body) RECEIPT_KEYS.add(o.body);
        if (o.link) RECEIPT_KEYS.add(o.link);
        }
      }
    }
  }

  for (const [locale, catalogue] of Object.entries(catalogues)) {
    test(`${locale} has a string for every key an outcome can name`, () => {
      const missing = [...RECEIPT_KEYS].filter(
        (k) => typeof catalogue.report?.receipt?.[k] !== "string",
      );
      assert.deepEqual(missing, [], `${locale} is missing report.receipt.*`);
    });
  }
});

describe("no catalogue promises a timetable", () => {
  // Identification is a daily cron that has never been deployed to production.
  // "Usually a minute or two" was a falsehood told to almost every reporter.
  const FORBIDDEN = [
    ["zh-TW", "一兩分鐘"],
    ["en", "minute or two"],
    ["en", "minutes"],
    ["zh-TW", "分鐘"],
  ];

  for (const [locale, phrase] of FORBIDDEN) {
    test(`${locale} nowhere says "${phrase}" about a report being identified`, () => {
      const receipt = JSON.stringify(catalogues[locale].report?.receipt ?? {});
      assert.ok(
        !receipt.includes(phrase),
        `report.receipt in ${locale} promises a duration: ${phrase}`,
      );
    });
  }

  test("neither catalogue still carries the old promise anywhere", () => {
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      const all = JSON.stringify(catalogue);
      for (const phrase of ["一兩分鐘", "minute or two"]) {
        assert.ok(!all.includes(phrase), `${locale} still contains "${phrase}"`);
      }
    }
  });
});
