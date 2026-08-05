"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { currentRole } from "@/lib/auth";

/**
 * Confirm or correct a report's species.
 *
 * Permitted for the report's own author, or any moderator. Anonymous reports have
 * no author, so only moderators can correct them — otherwise any visitor could
 * rewrite the identification on someone else's record.
 *
 * A correction is the highest-value signal this project produces: it is both the
 * fix for this record and future training data.
 */
export async function confirmSpecies(reportId: string, taxonId: number) {
  const { userId, role } = await currentRole();
  const moderator = role === "moderator" || role === "admin";

  if (!userId) throw new Error("sign in to confirm an identification");

  const [report] = await sql<{ reporter_id: string | null }[]>`
    select reporter_id from reports where id = ${reportId}::uuid`;
  if (!report) throw new Error("report not found");

  if (!moderator && report.reporter_id !== userId) {
    throw new Error("only the reporter or a moderator can change this");
  }

  // Setting taxon_id re-fires set_report_public_location(), so correcting a record
  // to a protected species blurs its location in the same statement. Clearing the
  // override hands control back to the taxon's own policy.
  await sql.begin(async (tx) => {
    await tx`
      update reports
         set taxon_id = ${taxonId},
             taxon_source = ${moderator ? "expert" : "user"},
             precision_override = null
       where id = ${reportId}::uuid`;
    await tx`
      insert into moderation_actions (report_id, actor_id, action, reason)
      values (${reportId}::uuid, ${userId}::uuid, 'retaxon', ${moderator ? "expert confirm" : "reporter confirm"})`;
  });

  revalidatePath(`/reports/${reportId}`);
}
