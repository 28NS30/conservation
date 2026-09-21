"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { currentRole } from "@/lib/auth";
import { withinRateLimit } from "@/lib/abuse";
import { recategorise, type Category } from "@conservation/shared";

/**
 * Confirm or correct a report's species.
 *
 * Permitted for the report's own author, or any moderator. Anonymous reports have
 * no author, so only moderators can correct them — otherwise any visitor could
 * rewrite the identification on someone else's record.
 *
 * A correction is the highest-value signal this project produces: it is both the
 * fix for this record and future training data.
 *
 * A REPORTER MAY ONLY PICK FROM THE CLASSIFIER'S OWN CANDIDATES. This is a server
 * action, which means it is a public POST endpoint — the fact that SpeciesConfirm
 * renders only the top five suggestions constrains the UI and nothing else. Until
 * this check existed, a signed-in reporter could set their own report to any of
 * the ~125k rows in `taxa`, and the write below both stamps `taxon_source='user'`
 * (exported to GBIF as an identification the reporter stands behind) and clears
 * `precision_override`, handing precision back to the named taxon's own policy.
 * Naming a non-sensitive taxon therefore published exact coordinates for whatever
 * the photograph actually showed. Harmless while nobody had a reason to want it;
 * the moment any reward attaches to a species, this is the endpoint that mints it.
 *
 * Moderators are deliberately unconstrained: the whole point of an expert
 * correction is that the classifier's five guesses were wrong.
 *
 * A reporter who knows the species and does not see it listed has no path here.
 * That is a real loss — it is the highest-value correction of all — and the fix
 * is a "none of these" route that files a suggestion for a moderator rather than
 * writing `taxon_id` directly. Worth building; it is not this function.
 */
export async function confirmSpecies(reportId: string, taxonId: number) {
  const { userId, role } = await currentRole();
  const moderator = role === "moderator" || role === "admin";

  if (!userId) throw new Error("sign in to confirm an identification");

  // Unbounded until now: the submission limits in lib/abuse.ts are applied in
  // app/api/reports/route.ts and have never covered this path. A reporter can
  // only ever re-taxon their own reports, so this is a backstop against churn
  // rather than a fraud control, and it is set well above honest use.
  if (!(await withinRateLimit(`retaxon:user:${userId}`, 3600, 60))) {
    throw new Error("too many identification changes — try again later");
  }

  const [report] = await sql<
    { reporter_id: string | null; category: string }[]
  >`
    select reporter_id, category from reports where id = ${reportId}::uuid`;
  if (!report) throw new Error("report not found");

  if (!moderator && report.reporter_id !== userId) {
    throw new Error("only the reporter or a moderator can change this");
  }

  if (!moderator) {
    const [candidate] = await sql<{ ok: boolean }[]>`
      select true as ok
        from classifications
       where report_id = ${reportId}::uuid
         and taxon_id  = ${taxonId}
       limit 1`;
    if (!candidate) {
      throw new Error("pick one of the suggested species");
    }
  }

  // Setting taxon_id re-fires set_report_public_location(), so correcting a record
  // to a protected species blurs its location in the same statement.
  //
  // The override is cleared only when this report had NO taxon. That case is
  // the system's own "we do not know what this is yet" stamp, and naming the
  // animal is precisely what it was waiting for, so precision goes back to the
  // named taxon's own policy.
  //
  // An override on a report that ALREADY has a taxon is a different thing: a
  // decision that this record stays coarser than its taxon's rating asks. The
  // GBIF name remap writes 371 of them, for records whose old name justified a
  // blur that the corrected name would not — exactly the case where clearing
  // it would quietly publish a location somebody had decided to withhold. So
  // those are left alone, and the trigger keeps taking the stricter of the two.
  //
  // And the category follows the species. `category` was written once at insert
  // and never revisited, so a `sighting` confirmed to be a listed invasive
  // stayed a `sighting` and never appeared under the map's invasive filter: the
  // record was right about the animal and wrong about what kind of record it
  // was. `recategorise` only ever moves sighting <-> invasive — condition wins
  // over species, and nobody revises whether the animal was dead.
  await sql.begin(async (tx) => {
    const [taxon] = await tx<{ is_invasive: boolean | null }[]>`
      select is_invasive from taxa where id = ${taxonId}`;
    const category = recategorise(
      report.category as Category,
      taxon?.is_invasive ?? null,
    );

    await tx`
      update reports
         set taxon_id = ${taxonId},
             taxon_source = ${moderator && report.reporter_id !== userId ? "expert" : "user"},
             category = ${category},
             precision_override = case
               when taxon_id is null then null
               else precision_override
             end
       where id = ${reportId}::uuid`;
    await tx`
      insert into moderation_actions (report_id, actor_id, action, reason)
      values (${reportId}::uuid, ${userId}::uuid, 'retaxon', ${moderator ? "expert confirm" : "reporter confirm"})`;
  });

  revalidatePath(`/reports/${reportId}`);
}
