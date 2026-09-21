"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { currentRole } from "@/lib/auth";
import { recategorise, type Category } from "@conservation/shared";

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

export async function rejectReport(reportId: string, reason: string) {
  const actor = await requireModerator();
  await sql.begin(async (tx) => {
    await tx`update reports set status = 'rejected' where id = ${reportId}::uuid`;
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
 * This one has never cleared `precision_override` and still does not. See the
 * note in the other file: neither path now weakens a blur somebody decided on.
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
                    category = ${category}
              where id = ${reportId}::uuid`;
    await tx`insert into moderation_actions (report_id, actor_id, action, reason)
             values (${reportId}::uuid, ${actor}::uuid, 'retaxon', ${String(taxonId)})`;
  });
  revalidatePath("/admin");
}
