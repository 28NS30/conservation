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

  test("a flush that can get tokens is never folded into one that cannot", () => {
    // The service worker's Background Sync ping flushes with no token provider
    // and, under a challenge, skips every report. Registered by the same mount
    // as the banner, it often starts just before the banner's own flush, and
    // the banner's flush used to be coalesced into it: the report stayed
    // waiting on a page that could have sent it. Seen in e2e/offline.spec.mjs
    // against a build with a Turnstile site key.
    assert.match(flush, /if \(!getToken \|\| inFlightHasToken\) return inFlight;/);
    assert.match(flush, /await inFlight\.catch\(\(\) => undefined\);\s*return flushQueue\(getToken\);/);
    assert.match(flush, /inFlightHasToken = Boolean\(getToken\);/);
  });

  test("the banner sends a report saved on a page that already sent one", () => {
    // Its automatic flush ran once per page. The report pages save on an
    // online page ("weak signal? save on this phone"), and a report saved
    // after that first flush waited for the tab to be hidden and shown again.
    assert.doesNotMatch(banner, /autoFlushedRef\.current = true/);
    assert.match(banner, /items\.filter\(\(i\) => !autoFlushedRef\.current\.has\(i\.id\)\)/);
  });

  test("a request that never answers cannot hold the queue", () => {
    // Every later flush is coalesced into the one in flight, so a POST that
    // never came back on one bar of signal kept every queued report on the
    // phone until the page was reloaded.
    assert.equal(
      (flush.match(/signal: AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/g) ?? []).length,
      2,
      "both of the flush's own requests must give up in the end",
    );
  });

  test("no network is not called a fault at our end, and costs no attempt", () => {
    // `navigator.onLine` says true on one bar of signal, so the flush does run
    // with no way through, and `fetch` rejects with a TypeError. That was
    // stored as "unknown" and shown as "something went wrong at our end" —
    // under a banner that had just said there was no signal — and each one
    // spent one of the report's eight attempts.
    // One definition of "never reached us" (lib/report/errors.ts), which a
    // photograph that never reached Storage now meets too.
    assert.match(flush, /const network = isNetworkFailure\(e\);/);
    assert.match(flush, /network \? NETWORK :/);
    assert.match(flush, /const attempts = network \|\| limited \? item\.attempts : item\.attempts \+ 1;/);
    const en = JSON.parse(read("messages", "en.json"));
    const zh = JSON.parse(read("messages", "zh-TW.json"));
    assert.match(en.report.errors.network, /report page/);
    assert.match(zh.report.errors.network, /通報頁面/);
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
