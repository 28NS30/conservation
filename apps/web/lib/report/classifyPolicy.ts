/**
 * What the classifier is allowed to do with its answer.
 *
 * The worker used to treat every report the same: a top answer in the high
 * band became the record's species, and the record was published under it.
 * For an invasive-species report that is dangerous in a specific, measured
 * way. The model scores an `invasive` report only against TaiCOL's invasive
 * register, so a photograph of any animal is forced onto the nearest invasive
 * one — and it is forced there confidently. On 308 cached evaluation photos,
 * 100 of the 276 native animals landed in the high band as an invasive
 * species: a native 布氏樹蛙 scored 1.0 as the invasive 斑腿樹蛙, a native
 * 斑龜 0.998 as the red-eared slider. The worker would have named each of
 * them invasive, in public, and published it at the named species' blur —
 * which, for a protected native taken for an unprotected invasive, is its
 * exact position.
 *
 * So the answer on an invasive report is a suggestion only, whatever the
 * band: it is stored the way every suggestion is (as `classifications` rows,
 * shown through `report_ai_suggestions`) and the record stays unidentified,
 * at the unidentified blur, until a person names it. The list of categories
 * the model may name a species on is an allowlist, so a category added later
 * starts out suggestion-only too rather than inheriting auto-assignment by
 * default.
 *
 * Pure and dependency-free so the rule can be tested without a database, a
 * model endpoint or a photograph — none of which CI has.
 */

/** Only auto-assign a species when the model is confident; see apps/ml/evaluate.py. */
export const AUTO_ASSIGN_BANDS: ReadonlySet<string> = new Set(["high"]);

/**
 * Categories whose answer may become the record's species.
 *
 * The condition is the label list the model is scored against, not the page:
 * each of these lists holds every protected animal. `sighting` and `injured`
 * are scored against the whole Taiwan checklist, `roadkill` against it minus
 * the fish and other marine-only taxa that cannot be on a road, with the
 * protected ones kept however marine they are (apps/ml/labelsets.py). A
 * confident answer from a list that holds the right animal is evidence; from a
 * list that leaves it out, it is only the least bad fit inside the closure, and
 * a protected animal taken for an unprotected one is published at the wrong
 * one's blur — to the metre, often. test/classify-policy.test.mjs reads
 * labelsets.py to hold every category here to that.
 *
 * `injured` is not narrowed the way `roadkill` is, though both are filed from
 * the same choice. An injured animal is not only found on a road: a stranded
 * dolphin or sea turtle is exactly what 受傷野生動物 receives, and the roadkill
 * list dropped all 37 marine mammals (36 of them protected) and all 5 sea
 * turtles (all protected). Scored against that list, as was once proposed, a stranded 綠蠵龜
 * could only be named as the nearest land or freshwater animal, and in the
 * high band it would be published under that animal's name and blur.
 */
export const AUTO_ASSIGN_CATEGORIES: ReadonlySet<string> = new Set([
  "roadkill",
  "injured",
  "sighting",
]);

/**
 * - `assign`  — the top answer becomes the record's species.
 * - `record`  — a person already named it; the model's answer is noted beside
 *               theirs and changes nothing.
 * - `suggest` — the answers are kept as suggestions and the record stays
 *               unidentified.
 */
export type ClassifierAction = "assign" | "record" | "suggest";

export function classifierAction(input: {
  /** The stored category, i.e. the page the report was filed on. */
  category: string;
  band: string;
  /** Whether the model returned any prediction at all. */
  hasPrediction: boolean;
  /** The reporter or a moderator named the species, not the model. */
  humanIdentified: boolean;
}): ClassifierAction {
  // A person looked at the animal; the model looked at a photograph.
  if (input.humanIdentified) return "record";
  if (!input.hasPrediction) return "suggest";
  if (!AUTO_ASSIGN_CATEGORIES.has(input.category)) return "suggest";
  return AUTO_ASSIGN_BANDS.has(input.band) ? "assign" : "suggest";
}
