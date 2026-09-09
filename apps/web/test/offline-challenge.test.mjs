/**
 * The offline queue's Turnstile contract.
 *
 * `e2e/offline.spec.mjs` runs the whole queue end to end and passed throughout
 * the period this was broken, because local development has no
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY and no TURNSTILE_SECRET_KEY — so no token is
 * required and none is sent, and the two halves agree. In production both keys
 * are set, `/api/reports` answers 403 challenge_failed to a tokenless
 * submission, and every queued report was written off as permanently rejected.
 * The one feature built for places with no signal discarded exactly those
 * reports.
 *
 * That is not reachable from a test without a Cloudflare account, so these pin
 * the contract at the source level instead. They are deliberately blunt: a
 * regression here is silent in every environment a test can run in.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...p) =>
  readFileSync(join(import.meta.dirname, "..", ...p), "utf8");

const flush = read("lib", "offline", "flush.ts");
const form = read("components", "report", "ReportForm.tsx");
const banner = read("components", "report", "QueueBanner.tsx");
const route = read("app", "api", "reports", "route.ts");

describe("offline queue challenge", () => {
  test("the server still requires a token, so the queue must carry one", () => {
    assert.match(
      route,
      /verifyTurnstile\(input\.turnstileToken/,
      "if this check is gone, these tests are describing a problem that no longer exists",
    );
  });

  test("the flush sends a turnstileToken", () => {
    assert.match(
      flush,
      /body: JSON\.stringify\(\{[\s\S]*?turnstileToken[\s\S]*?\}\)/,
      "the queued submission must include a challenge token",
    );
  });

  test("a missing token holds the report back instead of spending an attempt", () => {
    // The ordering is the whole point: no token must be detected before
    // `attempts` is incremented, or an unsendable-right-now report is ground
    // down to `failed` by retries that never had a chance.
    const skip = flush.indexOf('return "skipped"');
    const spend = flush.indexOf("attempts: item.attempts + 1");
    assert.ok(skip > 0, "there must be a skip path");
    assert.ok(
      skip < spend,
      "the token check has to come before the attempt is counted",
    );
    assert.match(flush, /if \(turnstileEnabled && !turnstileToken\)/);
  });

  test("a 403 challenge_failed is retryable, unlike other 4xx", () => {
    const challenge = flush.indexOf(
      'res.status === 403 && data.error === "challenge_failed"',
    );
    const permanent = flush.indexOf("res.status >= 400 && res.status < 500");
    assert.ok(challenge > 0, "challenge failures must be handled explicitly");
    assert.ok(
      challenge < permanent,
      "the retryable case must be checked before the write-off case",
    );
  });

  test("the form does not queue a token, because it would be stale by flush time", () => {
    // Tokens are single-use and expire in about five minutes. A report queued
    // on a mountain road overnight would carry a dead one.
    const enqueue = form.slice(
      form.indexOf("await enqueue("),
      form.indexOf("photos: photos.map"),
    );
    assert.ok(
      !/turnstileToken/.test(enqueue),
      "a queued payload must not carry a token; one is minted at flush time",
    );
  });

  test("something on screen owns the widget whenever the queue is non-empty", () => {
    assert.match(
      banner,
      /<Turnstile/,
      "the queue banner must render a challenge",
    );
    assert.match(
      banner,
      /flushQueue\(getToken\)/,
      "and must feed its tokens to the flush",
    );
  });
});
