/**
 * A scheduled job must be both declared where Vercel looks and callable the way
 * Vercel calls it.
 *
 * Two independent faults hid behind each other here, and the site ran for weeks
 * with the classification loop having never executed once.
 *
 * 1. The `crons` block lived in the repository root `vercel.json`. Vercel reads
 *    configuration from the project's Root Directory, which is `apps/web`, so
 *    the file was ignored outright and the two schedules were never created.
 * 2. Both job routes exported only `POST`. Vercel Cron issues **GET**, so even
 *    after fixing (1) every nightly invocation would have been answered 405.
 *
 * Neither fault can announce itself. A cron that was never created does not
 * appear anywhere to be missing, and a cron that 405s writes no job row, logs
 * no application error and leaves reports sitting at `pending` — which looks
 * exactly like "nobody has submitted anything yet".
 *
 * `docs/launch-checklist.md` asserted that moving the block was sufficient. It
 * was not. This test is here so the next person to touch either half cannot
 * reintroduce the silence.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(WEB, "..", "..");

const config = JSON.parse(readFileSync(join(WEB, "vercel.json"), "utf8"));

describe("the crons are declared where Vercel reads them", () => {
  test("apps/web/vercel.json owns the schedules", () => {
    assert.ok(
      Array.isArray(config.crons) && config.crons.length > 0,
      "no crons in apps/web/vercel.json — Vercel reads config from the Root Directory, which is apps/web",
    );
  });

  test("the repo root does not also claim to configure the deployment", () => {
    // A root vercel.json is not merged, not warned about, and not applied. Its
    // only effect is to convince a reader that something is configured.
    assert.equal(
      existsSync(join(REPO, "vercel.json")),
      false,
      "a root vercel.json is silently ignored; put deployment config in apps/web/vercel.json",
    );
  });

  test("the region is still pinned beside the DB", () => {
    assert.deepEqual(config.regions, ["hnd1"]);
  });
});

describe("every cron path answers the method Vercel sends", () => {
  for (const job of config.crons ?? []) {
    const file = join(WEB, "app", job.path, "route.ts");

    test(`${job.path} has a route file`, () => {
      assert.ok(existsSync(file), `${job.path} is scheduled but ${file} does not exist`);
    });

    test(`${job.path} exports GET — the method Vercel Cron uses`, () => {
      const src = readFileSync(file, "utf8");
      assert.match(
        src,
        /export async function GET\s*\(/,
        `${job.path} is scheduled but exports no GET handler, so every invocation answers 405`,
      );
    });

    test(`${job.path} cannot be prerendered`, () => {
      // Uncached is the default for Route Handlers today, and both of these read
      // an Authorization header, so neither can currently be static. Under Cache
      // Components a GET handler CAN be prerendered at build time, and a
      // prerendered job answers the cron from a static file without ever
      // touching the queue — the same silence as a 405, harder to find.
      const src = readFileSync(file, "utf8");
      assert.match(
        src,
        /export const dynamic = "force-dynamic"/,
        `${job.path} should pin force-dynamic so it can never be prerendered`,
      );
    });

    test(`${job.path} is behind CRON_SECRET`, () => {
      // Adding GET widened the surface, so assert the gate is still there.
      const src = readFileSync(file, "utf8");
      assert.match(src, /CRON_SECRET/, `${job.path} must check CRON_SECRET`);
      assert.match(
        src,
        /status:\s*401/,
        `${job.path} must answer 401 when the secret does not match`,
      );
    });

    test(`${job.path} keeps a daily-or-finer schedule Hobby can run`, () => {
      // Hobby allows one invocation per day per cron. If someone tightens this
      // to hourly the deploy fails at build time with an unhelpful message;
      // this says why first.
      assert.match(
        job.schedule,
        /^\d+ \d+ \* \* \*$/,
        `${job.path}: "${job.schedule}" is finer than daily, which Vercel Hobby rejects — upgrade the plan or use an external scheduler against POST`,
      );
    });
  }
});
