/**
 * Why a report was held, in words a moderator can read.
 *
 * `reports.flagged_reason` is written as an English sentence by four places:
 * the abuse screen (lib/abuse.ts), the classifier's policy
 * (lib/report/classifyPolicy.ts) and the two paths that record its answer
 * (classifyWorker.ts, classifyEvidence.ts). The moderation queue printed it
 * as stored, so a moderator on the Chinese site read "no photo on a category
 * that expects one" beside every held report.
 *
 * The stored sentence stays as it is: it is also what the logs, the tests and
 * anyone reading the database see, and six of them carry a species name. It
 * is matched here to a message key under `admin.flag`, with the name as a
 * parameter, when the queue shows it.
 *
 * A sentence nobody has taught this file is shown as stored, never dropped:
 * an untranslated reason is still the reason, and a moderator told nothing
 * would publish a report that was held for a cause.
 */

export type FlagKey =
  | "outsideTaiwan"
  | "noPhoto"
  | "linksInNotes"
  | "disagrees"
  | "notIdentified"
  | "lowConfidence"
  | "onlySuggests"
  | "unavailable"
  | "suspectsInvasive"
  | "mixedForms"
  | "looksNative"
  | "wrongModel"
  | "onlySuggestsClass"
  | "includesInvasive"
  | "stricterSibling";

export type FlagReason = { key: FlagKey; values: Record<string, string> };

/** Each stored sentence, and the names its parameters take, in order. */
const PATTERNS: [RegExp, FlagKey, string[]][] = [
  [/^coordinates outside Taiwan$/, "outsideTaiwan", []],
  [/^no photo on a category that expects one$/, "noPhoto", []],
  [/^links or handles in notes$/, "linksInNotes", []],
  [/^the model and the reporter name different species$/, "disagrees", []],
  [/^model could not identify this with any confidence$/, "notIdentified", []],
  [/^low confidence identification$/, "lowConfidence", []],
  [/^the model only suggests a species for this kind of report$/, "onlySuggests", []],
  [/^classification unavailable$/, "unavailable", []],
  [/^the model suspects the invasive (.+); a person must confirm$/, "suspectsInvasive", ["name"]],
  [/^the model suggests (.+), which has native and introduced forms; needs an expert$/, "mixedForms", ["name"]],
  [/^the model thinks this looks like a native animal \((.+)\); a person must confirm$/, "looksNative", ["name"]],
  [/^the thresholds were fitted for .+; suggestions only$/, "wrongModel", []],
  [/^the model suggests (.+), which is or includes an invasive form; a person must confirm$/, "includesInvasive", ["name"]],
  [/^the model only suggests (.+) species$/, "onlySuggestsClass", ["group"]],
  [
    /^the model is sure of (.+), but lists (.+), which is blurred more strictly; a person must confirm$/,
    "stricterSibling",
    ["name", "other"],
  ],
];

/** The message key and parameters for a stored reason, or null if unknown. */
export function flagReason(stored: string): FlagReason | null {
  for (const [pattern, key, names] of PATTERNS) {
    const m = pattern.exec(stored);
    if (!m) continue;
    const values: Record<string, string> = {};
    names.forEach((n, i) => (values[n] = m[i + 1]));
    return { key, values };
  }
  return null;
}
