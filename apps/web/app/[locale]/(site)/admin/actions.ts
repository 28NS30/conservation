"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { currentRole } from "@/lib/auth";
import { OFFERED } from "@/lib/species";
import { requeueClassification } from "@/lib/report/classificationHold";
import {
  keepDeliberateOverride,
  photoIdentificationOverride,
} from "@/lib/report/precision";

/**
 * Moderation mutations.
 *
 * Every action re-checks the caller's role server-side. A server action is a
 * public HTTP endpoint — rendering the admin page behind a check does not
 * protect the actions it links to.
 */
async function requireModerator(): Promise<string> {
  const { userId, role } = await currentRole();
  if (!userId || (role !== "moderator" && role !== "admin")) {
    throw new Error("forbidden");
  }
  return userId;
}

// Note: each action writes its own moderation_actions row *inside* its
// transaction. A shared helper would run on a different connection and lose that
// atomicity, so the small duplication is deliberate.

export async function publishReport(reportId: string) {
  const actor = await requireModerator();
  // Only a report still waiting. The queue page stays open, and a row another
  // moderator has already decided still shows its buttons: without this, the
  // last click won, and a report one moderator rejected went back on the map
  // when another published it from a stale screen.
  await sql.begin(async (tx) => {
    const done = await tx`update reports set status = 'published', flagged_reason = null
                           where id = ${reportId}::uuid and status = 'pending'
                           returning id`;
    if (done.length === 0) throw new Error("already decided");
    await tx`insert into moderation_actions (report_id, actor_id, action)
             values (${reportId}::uuid, ${actor}::uuid, 'publish')`;
  });
  revalidatePath("/admin");
}

/**
 * Throw a report out.
 *
 * Also retires its classification job. The classifier no longer claims a job
 * whose report has been rejected, so this is not what makes the rejection
 * stick — but a queue carrying work for records that will never be published
 * is a queue whose depth means nothing, and the next person to read it should
 * not have to know about the filter to understand why.
 *
 * `done` with a reason rather than a delete: nothing here is worth losing, and
 * `classification_jobs` has no 'cancelled' state to spend a migration on.
 */
export async function rejectReport(reportId: string, reason: string) {
  const actor = await requireModerator();
  // The queue asks for a reason before it sends one, but an action is a
  // public endpoint: the log records why, so an empty why is refused here
  // too, and a long one is kept to what the queue's box allows.
  const why = String(reason ?? "").trim().slice(0, 500);
  if (!why) throw new Error("a reason is required");
  await sql.begin(async (tx) => {
    // Only a report still waiting; see publishReport.
    const done = await tx`update reports set status = 'rejected'
                           where id = ${reportId}::uuid and status = 'pending'
                           returning id`;
    if (done.length === 0) throw new Error("already decided");
    await tx`update classification_jobs
                set status = 'done',
                    last_error = 'report rejected; not classified',
                    updated_at = now()
              where report_id = ${reportId}::uuid
                and status in ('queued', 'failed')`;
    await tx`insert into moderation_actions (report_id, actor_id, action, reason)
             values (${reportId}::uuid, ${actor}::uuid, 'reject', ${why})`;
  });
  revalidatePath("/admin");
}

/**
 * Correct a report's species. The obscuring trigger fires on `taxon_id`, so this
 * automatically re-derives the location precision — correcting a record to a
 * protected species blurs it in the same statement.
 *
 * It does NOT touch the category, which is the page the report was filed on
 * and stays that. It used to be rewritten here, as in
 * `reports/[id]/actions.ts`, so a `sighting` corrected to an invasive species
 * would show under the invasive filter; the copy drifted, because the
 * classifier and a TaiCOL refresh never rewrote it. Invasiveness is read from
 * the species at display time instead (`reports_public.is_invasive`, 0016), so
 * this correction moves the record into or out of the invasive collection by
 * naming the species alone. `taxonId` may be null — a moderator removing a
 * wrong name — and then a record filed on the invasive page stays in that
 * collection as the reporter left it, and any other leaves it.
 *
 * It now clears `precision_override` on the same rule as the other two paths —
 * `keepDeliberateOverride`. It never cleared it at all before, which is the
 * mirror of the defect the other path had: a moderator who identified a report
 * that had been stamped "we do not know what this is yet" left the stamp in
 * place, and the record they had just done the work of naming stayed blurred
 * to 10 km for good.
 *
 * And, naming a species, through `photoIdentificationOverride` like the other
 * two: the record takes at least the strictest rule of any row sharing the
 * binomial. A moderator works from the same photograph the model did, and the
 * names they can type include subspecies and species rows that need not carry
 * the same rating. Removing a name (null) has no binomial to consult.
 *
 * Only a name a report can be filed under (OFFERED, lib/species.ts), as
 * POST /api/reports accepts. No page calls this today, but an action is a
 * public endpoint whether or not a page calls it, and this one took any of
 * the ~136k rows in `taxa`: a retired duplicate, unrated beside the row the
 * law protects, or a genus, which no rating names. Either could publish a
 * protected animal more exactly than its own name would.
 */
export async function setReportTaxon(reportId: string, taxonId: number | null) {
  const actor = await requireModerator();
  await sql.begin(async (tx) => {
    const [report] = await tx<{ id: string }[]>`
      select id from reports where id = ${reportId}::uuid`;
    if (!report) throw new Error("report not found");

    if (taxonId !== null) {
      const [taxon] = await tx<{ offered: boolean }[]>`
        select ${sql.unsafe(OFFERED)} as offered from taxa t where t.id = ${taxonId}`;
      if (!taxon) throw new Error("taxon not found");
      if (!taxon.offered) throw new Error("not a name a report can be filed under");
    }

    await tx`update reports
                set taxon_id = ${taxonId}, taxon_source = 'expert',
                    precision_override = ${
                      taxonId === null
                        ? keepDeliberateOverride()
                        : photoIdentificationOverride(taxonId)
                    }
              where id = ${reportId}::uuid`;
    await tx`insert into moderation_actions (report_id, actor_id, action, reason)
             values (${reportId}::uuid, ${actor}::uuid, 'retaxon', ${String(taxonId)})`;
  });
  revalidatePath("/admin");
}

/**
 * Say a published record's flag has been looked at, and take it off the list.
 *
 * A record can be published and still carry a reason a person should look:
 * the classifier writes one when it publishes a record unidentified because
 * the model could only suggest a species, and when the model, confident,
 * names a different species from the reporter, whose name the record keeps.
 * Until the queue listed them nobody saw those flags at all.
 *
 * It clears the flag and nothing else. The species, the blur and the status
 * stay as they are, because "this is fine" is not a decision to publish a
 * location more exactly: a record held at the model's blur stays held, one
 * the model never answered for stays at 10 km and off the map (classifyAgain
 * is the way out of that), and a moderator who thinks the species is wrong
 * corrects it on the record's page.
 * `flagged_reason` fires no blur trigger, so this cannot move the point.
 *
 * Only a published record with a flag, so a stale screen cannot clear one
 * twice or touch a record that has since been rejected. The reason cleared is
 * kept in the log, which is the only place it survives. `flag` is the log's
 * own word for a flag decision (0003), so no migration is needed for it.
 */
export async function clearFlag(reportId: string) {
  const actor = await requireModerator();
  await sql.begin(async (tx) => {
    const [row] = await tx<{ flagged_reason: string }[]>`
      select flagged_reason from reports
       where id = ${reportId}::uuid
         and status = 'published'
         and flagged_reason is not null
       for update`;
    if (!row) throw new Error("no flag to clear");
    await tx`update reports set flagged_reason = null where id = ${reportId}::uuid`;
    await tx`insert into moderation_actions (report_id, actor_id, action, reason)
             values (${reportId}::uuid, ${actor}::uuid, 'flag',
                     ${`cleared: ${row.flagged_reason}`.slice(0, 500)})`;
  });
  revalidatePath("/admin");
}

/**
 * Have the model try a held record's photo again.
 *
 * A record its reporter named, with a photo, is held at 10 km and off the
 * map until the model has looked (lib/report/classificationHold.ts). When the
 * model refused the photo or the job ran out of attempts, it stays held for
 * good and is flagged here; this puts its job back in the queue, with its
 * attempts and error cleared, for the next run to claim.
 *
 * It does not release the hold. The record stays where it is until a run
 * finishes, which is the only thing that releases it, and a run that gives up
 * again flags it again. Only a published record that is still held, and only
 * when no job of its own is waiting already. Logged under `flag`, as OK is:
 * it is a decision about a flag, and the log's actions are fixed (0003).
 */
export async function classifyAgain(reportId: string) {
  const actor = await requireModerator();
  await sql.begin(async (tx) => {
    const queued = await requeueClassification(tx, reportId);
    if (!queued) throw new Error("nothing to classify again");
    await tx`insert into moderation_actions (report_id, actor_id, action, reason)
             values (${reportId}::uuid, ${actor}::uuid, 'flag',
                     ${`classify again: ${queued.flaggedReason ?? "no flag"}`.slice(0, 500)})`;
  });
  revalidatePath("/admin");
}
