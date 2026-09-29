/**
 * A photo is identified right after it is sent, not at 03:00 the next night.
 *
 * Vercel Hobby runs a cron at most once a day, and the daily run claimed three
 * jobs: that was the classifier's whole throughput. POST /api/reports now runs
 * the worker for the one report it just filed, in after(), once the reporter
 * has their answer; the cron stays as a sweeper. Source-level, because a test
 * build does not run the model (it would call the production service from a
 * laptop), so no runtime test can watch it happen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "..");
const code = (p) => readFileSync(join(WEB, p), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

test("the report route classifies the report it just queued, after responding", () => {
  const route = code("app/api/reports/route.ts");
  assert.match(route, /import \{ after \} from "next\/server"/);
  assert.match(route, /after\(async \(\) => \{\s*try \{\s*await classifyQueued\(\{ reportId: id \}\)/);
  // Only when a job was queued in the same transaction: a report with no
  // photo, or a duplicate, has nothing to classify.
  assert.match(route, /result\.queued && process\.env\.NEXT_PUBLIC_E2E !== "1"/);
  assert.match(route, /export const maxDuration = 60/);
});

test("the worker claims only that report's job when asked, and skips locked rows", () => {
  const worker = code("lib/report/classifyWorker.ts");
  assert.match(worker, /\$\{reportId\}::uuid is null or j\.report_id = \$\{reportId\}::uuid/);
  assert.match(worker, /limit \$\{reportId \? 1 : BATCH\}/);
  assert.match(worker, /for update skip locked/);
});

test("the cron route is a thin, authorised wrapper around the same worker", () => {
  const cron = code("app/api/jobs/classify/route.ts");
  assert.match(cron, /if \(!authorised\(req\)\)/);
  assert.match(cron, /Response\.json\(await classifyQueued\(\)\)/);
  assert.match(cron, /export const dynamic = "force-dynamic"/);
});
