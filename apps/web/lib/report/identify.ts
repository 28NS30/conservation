import "server-only";
import { sql } from "@/lib/db";
import { REPORT_PAGES, type ReportPage } from "@conservation/shared";
import { decideFromEvidence, mlContract, type Band } from "@/lib/report/classifyPolicy";
import { resolveCandidates } from "@/lib/report/classifyEvidence";
import { callModel, callEvidenceModel } from "@/lib/report/model";
import { OFFERED, inPageScope } from "@/lib/species";
import type { PhotoIdentification, PhotoSuggestion } from "@/lib/report/photoSuggestion";

/**
 * What the model says a photo shows, as the species the report form may offer
 * on this page, while the reporter is still filling it in.
 *
 * The team asked for the identification to appear as soon as a photo is
 * added, not only after the report is sent (30 September 2026). The reporter
 * chooses: nothing here names a species on a report. The same rules as the
 * worker decide what may be suggested (decideFromEvidence for the evidence
 * contract), and the same page scope as the picker decides what may be
 * offered, so a suggestion is always something the reporter could have
 * searched for on that page.
 *
 * Nothing is stored: the photo goes to the model and the answer comes back.
 */

/**
 * The least a species must score to be offered. The form shows each score as a
 * whole percentage, and a species the model puts under 1% would appear as a
 * "0%" choice a reporter could tap by mistake (a green iguana's photo came
 * back with 綠水龍 at 0.1% and 高冠變色龍 at 0%, 30 September 2026).
 */
const MIN_OFFERED_SCORE = 0.01;

/** The category whose rules a page's photos are judged by, before any is chosen. */
const CATEGORY_OF_PAGE: Readonly<Record<ReportPage, string>> = {
  roadkill: "roadkill",
  wildlife: "sighting",
  invasive: "invasive",
};

export async function identifyPhoto(
  imageBase64: string,
  page: ReportPage,
  timeoutMs: number,
): Promise<PhotoIdentification> {
  const category = CATEGORY_OF_PAGE[page];
  let band: Band;
  let ranked: { id: number; score: number }[];

  if (mlContract(process.env) === 2) {
    const result = await callEvidenceModel(imageBase64, timeoutMs);
    const decision = decideFromEvidence({
      category,
      candidates: await resolveCandidates(result),
      humanIdentified: false,
      modelVersion: result.modelVersion,
    });
    band = decision.band;
    ranked = decision.shown.map((c) => ({ id: c.taxonId, score: c.score }));
  } else {
    // The legacy contract picks its label list by category, and the invasive
    // one is the closed list that called native animals invasive: every photo
    // is scored against the whole checklist ('sighting'), and the page's
    // scope below decides what may be offered.
    const result = await callModel(imageBase64, page === "invasive" ? "sighting" : category, timeoutMs);
    band = result.band;
    ranked = result.predictions.slice(0, 5).map((p) => ({ id: p.taxon_id, score: p.score }));
  }

  ranked = ranked.filter((r) => r.score >= MIN_OFFERED_SCORE);

  // A list that is wrong a third of the time is not offered (as on the record
  // page, which withholds the low band's suggestions).
  if (band === "low" || ranked.length === 0) return { band, suggestions: [], outsidePage: null };

  const scope = inPageScope(REPORT_PAGES[page].species);
  const rows = await sql<
    (Omit<PhotoSuggestion, "score"> & { inScope: boolean; offered: boolean })[]
  >`
    select t.id, t.scientific_name as "scientificName",
           t.common_name_zh as "commonNameZh", t.common_name_en as "commonNameEn",
           t.taicol_id as "taicolId", t.is_invasive as "isInvasive",
           (select count(*)::int from reports_public rp where rp.taxon_id = t.id) as "reportCount",
           ${sql.unsafe(OFFERED)} as offered,
           ${sql.unsafe(scope)} as "inScope"
      from taxa t
     where t.id = any(${ranked.map((r) => r.id)}::bigint[])`;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const suggestions: PhotoSuggestion[] = [];
  let outsidePage: PhotoIdentification["outsidePage"] = null;
  for (const [i, r] of ranked.entries()) {
    const row = byId.get(r.id);
    if (!row?.offered) continue;
    if (!row.inScope) {
      if (i === 0 && page === "invasive")
        outsidePage = {
          scientificName: row.scientificName,
          commonNameZh: row.commonNameZh,
          commonNameEn: row.commonNameEn,
        };
      continue;
    }
    suggestions.push({
      id: row.id,
      scientificName: row.scientificName,
      commonNameZh: row.commonNameZh,
      commonNameEn: row.commonNameEn,
      taicolId: row.taicolId,
      isInvasive: row.isInvasive,
      reportCount: row.reportCount,
      score: r.score,
    });
  }
  return { band, suggestions, outsidePage };
}
