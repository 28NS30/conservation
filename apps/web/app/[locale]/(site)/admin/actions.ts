"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { currentRole } from "@/lib/auth";
import { recategorise, type Category } from "@conservation/shared";
import { keepDeliberateOverride } from "@/lib/report/precision";

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
  await sql.begin(async (tx) => {
    await tx`update reports set status = 'published', flagged_reason = null
              where id = ${reportId}::uuid`;
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
  await sql.begin(async (tx) => {
    await tx`update reports set status = 'rejected' where id = ${reportId}::uuid`;
    await tx`update classification_jobs
                set status = 'done',
                    last_error = 'report rejected; not classified',
                    updated_at = now()
              where report_id = ${reportId}::uuid
                and status in ('queued', 'failed')`;
    await tx`insert into moderation_actions (report_id, actor_id, action, reason)
             values (${reportId}::uuid, ${actor}::uuid, 'reject', ${reason})`;
  });
  revalidatePath("/admin");
}

/**
 * Correct a report's species. The obscuring trigger fires on `taxon_id`, so this
 * automatically re-derives the location precision — correcting a record to a
 * protected species blurs it in the same statement.
 *
 * It re-derives the CATEGORY too, for the same reason and by the same rule as
 * `reports/[id]/actions.ts`: a `sighting` corrected to a listed invasive is an
 * `invasive` record, and while it was not, such a record never appeared under
 * the map's invasive filter. `taxonId` may be null here — a moderator removing
 * a wrong name — and then the register has no opinion and the reporter's own
 * belief, carried in the category they were filed under, stands.
 *
 * It now clears `precision_override` on the same rule as the other two paths —
 * `keepDeliberateOverride`. It never cleared it at all before, which is the
 * mirror of the defect the other path had: a moderator who identified a report
 * that had been stamped "we do not know what this is yet" left the stamp in
 * place, and the record they had just done the work of naming stayed blurred
 * to 10 km for good.
 */
export async function setReportTaxon(reportId: string, taxonId: number | null) {
  const actor = await requireModerator();
  await sql.begin(async (tx) => {
    const [report] = await tx<{ category: string }[]>`
      select category from reports where id = ${reportId}::uuid`;
    if (!report) throw new Error("report not found");
    const [taxon] = taxonId
      ? await tx<{ is_invasive: boolean | null }[]>`
          select is_invasive from taxa where id = ${taxonId}`
      : [];
    const category = recategorise(
      report.category as Category,
      taxon?.is_invasive ?? null,
    );

    await tx`update reports
                set taxon_id = ${taxonId}, taxon_source = 'expert',
                    category = ${category},
                    precision_override = ${keepDeliberateOverride()}
              where id = ${reportId}::uuid`;
    await tx`insert into moderation_actions (report_id, actor_id, action, reason)
             values (${reportId}::uuid, ${actor}::uuid, 'retaxon', ${String(taxonId)})`;
  });
  revalidatePath("/admin");
}
