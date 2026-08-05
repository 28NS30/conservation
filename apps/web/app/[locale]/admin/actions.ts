"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { currentRole } from "@/lib/auth";

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
 */
export async function setReportTaxon(reportId: string, taxonId: number | null) {
  const actor = await requireModerator();
  await sql.begin(async (tx) => {
    await tx`update reports
                set taxon_id = ${taxonId}, taxon_source = 'expert'
              where id = ${reportId}::uuid`;
    await tx`insert into moderation_actions (report_id, actor_id, action, reason)
             values (${reportId}::uuid, ${actor}::uuid, 'retaxon', ${String(taxonId)})`;
  });
  revalidatePath("/admin");
}
