/**
 * Failures, in the reader's language, beside the thing that failed.
 *
 * Everything the submission path could go wrong with used to reach the screen
 * as itself: `challenge_failed` and `taxon_not_found` straight from the API,
 * English sentences assembled in the client — "upload signing failed (500)" —
 * and once the literal string "report.queueFailed", because a message key from
 * one namespace was looked up in another and next-intl renders a miss as its
 * own path. All of it under a Chinese banner, to someone standing beside a dead
 * animal on a mountain road.
 *
 * The mapping is the kind of thing that rots quietly: a route gains a code, the
 * catalogue does not, and the reporter is shown snake_case. So the routes are
 * read as the source of truth and every code they can emit is checked to land
 * somewhere a person can read.
 *
 *   node --test test/report-errors.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorKey, slotOf, describeFailure } from "../lib/report/errors.ts";

const read = (...p) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
const load = (l) => JSON.parse(read("messages", `${l}.json`));
const catalogues = { en: load("en"), "zh-TW": load("zh-TW") };

const ROUTES = [
  ["app/api/reports/route.ts", read("app", "api", "reports", "route.ts")],
  ["app/api/uploads/sign/route.ts", read("app", "api", "uploads", "sign", "route.ts")],
];
const FORM = read("components", "report", "ReportForm.tsx");
const BANNER = read("components", "report", "QueueBanner.tsx");
const FLUSH = read("lib", "offline", "flush.ts");

/** Every `error: "code"` either route can answer with. */
const codes = [
  ...new Set(
    ROUTES.flatMap(([, src]) =>
      [...src.matchAll(/error:\s*"([a-z_]+)"/g)].map((m) => m[1]),
    ),
  ),
].sort();

describe("every code the server can send has words", () => {
  test("the routes actually emit some, so this test is not vacuous", () => {
    assert.ok(codes.length >= 10, `only found ${codes.length}: ${codes}`);
  });

  for (const [locale, catalogue] of Object.entries(catalogues)) {
    test(`${locale} has a sentence for each of them`, () => {
      const unreadable = codes.filter(
        (c) => typeof catalogue.report?.errors?.[errorKey(c)] !== "string",
      );
      assert.deepEqual(
        unreadable,
        [],
        `these codes resolve to no string in ${locale}`,
      );
    });
  }

  test("and no sentence is the code itself", () => {
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      for (const [key, value] of Object.entries(catalogue.report.errors)) {
        assert.ok(
          !/^[a-z]+_[a-z_]+$/.test(String(value)),
          `${locale} report.errors.${key} looks like an identifier`,
        );
      }
    }
  });
});

describe("where each one is shown", () => {
  test("anything about a photograph goes beside the photographs", () => {
    for (const code of [
      "photo_missing",
      "photo_too_large",
      "photo_bad_type",
      "sign_failed",
      "bad_count",
      "bad_request",
      "photo_upload_failed",
      "photo_unreadable",
    ]) {
      assert.equal(describeFailure(code).slot, "photo", code);
    }
  });

  test("a species that no longer exists goes beside the picker", () => {
    assert.equal(describeFailure("taxon_not_found").slot, "species");
  });

  test("everything else goes with the button", () => {
    for (const code of ["rate_limited", "challenge_failed", "validation_failed"]) {
      assert.equal(describeFailure(code).slot, "form", code);
    }
  });

  test("an unrecognised code says the report was not sent, safely", () => {
    // Including an old queued row still holding one of the English sentences
    // this replaced. Whatever it was, the entries are still on screen.
    for (const code of [
      "bad_json",
      "insert_failed",
      "unknown",
      undefined,
      null,
      "upload signing failed (500)",
    ]) {
      assert.equal(errorKey(code), "server", String(code));
      assert.equal(slotOf(errorKey(code)), "form");
    }
  });
});

describe("nothing written for a developer reaches the screen", () => {
  test("the form never renders a thrown message", () => {
    assert.ok(
      !/setError\([^)]*\.message/.test(FORM),
      "an Error's message is for the console, not the reporter",
    );
    assert.ok(
      !/setError\(`/.test(FORM),
      "no interpolated string may be put into the error state",
    );
    assert.match(
      FORM,
      /console\.error\("\[report\]/,
      "the code itself should still be logged",
    );
  });

  test("the queue banner translates the stored code instead of printing it", () => {
    assert.ok(
      !/\{i\.lastError\}/.test(BANNER),
      "the raw stored code must not be rendered",
    );
    assert.match(BANNER, /tReport\(`errors\.\$\{errorKey\(i\.lastError\)\}`\)/);
  });

  test("the flush stores a code, not a sentence", () => {
    assert.ok(
      !/lastError: `/.test(FLUSH) && !/lastError: message/.test(FLUSH),
      "lastError must hold something translatable",
    );
    assert.match(FLUSH, /lastError: code/);
    assert.match(FLUSH, /lastError: data\.error \?\? "unknown"/);
  });

  test("the key that was interpolated instead of translated is gone", () => {
    // `t` is the `report` namespace; queueFailed lives in `offline`, so
    // t("queueFailed") rendered the literal text "report.queueFailed" to the
    // one person whose report had failed to save anywhere at all.
    assert.ok(!/\bt\("queueFailed"\)/.test(FORM));
    assert.match(FORM, /tOffline\("queueFailed"\)/);
  });
});

describe("a rejected submission does not spend the next attempt too", () => {
  test("the form resets the challenge after a failure", () => {
    // Turnstile tokens are single-use. Retrying with the spent one produced
    // `challenge_failed` however sound the second attempt was, and told the
    // reporter their browser had failed a check it had just passed.
    assert.match(FORM, /resetTurnstile\.current\?\.\(\)/);
    assert.match(FORM, /setTurnstileToken\(null\)/);
    const reset = FORM.indexOf("resetTurnstile.current?.()");
    const failed = FORM.indexOf("const code = e instanceof ReportError");
    assert.ok(failed > 0 && reset > failed, "the reset belongs on the failure path");
  });
});
