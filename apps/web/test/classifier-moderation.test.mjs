/**
 * What the classifier is allowed to do to a report a moderator has decided.
 *
 * Rejecting a report did not cancel its classification job, and the worker's
 * claim query filtered on the JOB's status alone. So the job was claimed, the
 * model ran, and the branch wrote `status = 'published'` straight over the
 * rejection. Spam a moderator had removed went back on the public map on the
 * next cron run, and nothing anywhere said it had.
 *
 * Two layers, and both are tested here because they fail differently. The
 * claim filter stops the work happening at all. The status guard is for the
 * gap between them: claim and process are separate transactions, so a report
 * can be rejected after its job is claimed and before the result is written.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback, insertReport } from "./helpers.mjs";

after(() => sql.end());

const ROUTE = readFileSync(
  join(import.meta.dirname, "..", "app", "api", "jobs", "classify", "route.ts"),
  "utf8",
);
const ADMIN = readFileSync(
  join(import.meta.dirname, "..", "app", "[locale]", "(site)", "admin", "actions.ts"),
  "utf8",
);

/** The claim query's predicate, as the route writes it. */
const claimable = (tx, reportId) => tx`
  select count(*)::int as n
    from classification_jobs j
   where j.report_id = ${reportId}
     and j.status in ('queued','failed')
     and exists (select 1 from reports r
                  where r.id = j.report_id and r.status <> 'rejected')`;

/** The publication guard, as both branches write it. */
const publish = (tx, reportId) => tx`
  update reports
     set status = case when status = 'pending' then 'published' else status end
   where id = ${reportId}
  returning status`;

describe("a rejected report is not classified", () => {
  test("its job is never claimed", async () => {
    await inRollback(async (tx) => {
      const r = await insertReport(tx, { status: "rejected" });
      await tx`insert into classification_jobs (report_id) values (${r.id})`;
      const [{ n }] = await claimable(tx, r.id);
      assert.equal(n, 0, "the worker would have picked this up");
    });
  });

  test("a pending report's job still is", async () => {
    // The filter has to be narrow: holding an unidentified report until the
    // model looks at it is the entire point of the queue.
    await inRollback(async (tx) => {
      const r = await insertReport(tx, { status: "pending" });
      await tx`insert into classification_jobs (report_id) values (${r.id})`;
      const [{ n }] = await claimable(tx, r.id);
      assert.equal(n, 1);
    });
  });

  test("and so does a published one, because the model's opinion is still worth having", async () => {
    // A job is queued even when the reporter named the species. That branch
    // writes no status; it records what the model thought beside what the
    // person who was there said.
    await inRollback(async (tx) => {
      const r = await insertReport(tx, { status: "published" });
      await tx`insert into classification_jobs (report_id) values (${r.id})`;
      const [{ n }] = await claimable(tx, r.id);
      assert.equal(n, 1);
    });
  });
});

describe("publishing may lift a hold, not reverse a decision", () => {
  test("a rejected report stays rejected", async () => {
    await inRollback(async (tx) => {
      const r = await insertReport(tx, { status: "rejected" });
      const [row] = await publish(tx, r.id);
      assert.equal(row.status, "rejected");
    });
  });

  test("a pending report is published", async () => {
    await inRollback(async (tx) => {
      const r = await insertReport(tx, { status: "pending" });
      const [row] = await publish(tx, r.id);
      assert.equal(row.status, "published");
    });
  });
});

describe("the route and the console agree", () => {
  test("the claim query excludes rejected reports", () => {
    assert.match(ROUTE, /r\.status <> 'rejected'/);
  });

  test("neither branch writes an unguarded 'published'", () => {
    // `status = 'published'` with no condition is the defect itself. Comments
    // are stripped first: this assertion failed on the sentence describing the
    // defect in the fix's own comment, which is a test reading prose.
    const code = ROUTE.split("\n")
      .filter((l) => !/^\s*(--|\/\/|\*)/.test(l))
      .join("\n");
    const unguarded = code.match(/status = 'published'/g) ?? [];
    assert.deepEqual(unguarded, [], "a status write with no guard on it");
    assert.equal(
      (code.match(/case when status = 'pending' then 'published'/g) ?? []).length,
      2,
      "both branches that publish should be guarded",
    );
  });

  test("rejecting a report retires its job", async () => {
    assert.match(ADMIN, /update classification_jobs/);
    await inRollback(async (tx) => {
      const r = await insertReport(tx, { status: "published" });
      await tx`insert into classification_jobs (report_id) values (${r.id})`;
      await tx`update reports set status = 'rejected' where id = ${r.id}`;
      await tx`update classification_jobs
                  set status = 'done',
                      last_error = 'report rejected; not classified',
                      updated_at = now()
                where report_id = ${r.id} and status in ('queued', 'failed')`;
      const [job] = await tx`select status, last_error from classification_jobs
                              where report_id = ${r.id}`;
      assert.equal(job.status, "done");
      assert.match(job.last_error, /rejected/);
    });
  });
});
