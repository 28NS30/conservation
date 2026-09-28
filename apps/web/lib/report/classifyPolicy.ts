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
 * Categories whose label list is the whole Taiwan checklist, or the whole of
 * it minus animals that cannot be on a road. A confident answer from an open
 * list is evidence; a confident answer from a closed one is only the least bad
 * fit inside the closure.
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

/**
 * The category the model is asked to score against, which chooses its label
 * list (apps/ml/labelsets.py).
 *
 * An injured animal is filed from the same "roadkill or injured" choice as a
 * dead one and is found in the same places, but labelsets.py only narrowed
 * `roadkill` — so an injured animal was scored against the full checklist,
 * reef fish and all. Mapped here as well as there because a change to the
 * Python only takes effect when the Modal app is redeployed, and this one
 * takes effect with the website.
 */
export function labelSetFor(category: string): string {
  return category === "injured" ? "roadkill" : category;
}
