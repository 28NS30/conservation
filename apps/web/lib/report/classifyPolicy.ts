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

// `with { type: "json" }` is not decoration: `node --test` type-strips this
// file to run test/classify-policy.test.mjs and test/classify-evidence.test.mjs
// against it, and Node refuses a JSON import without the attribute. Next reads
// it the same way (lib/lab/fonts.ts does the same).
import thresholds from "./classifier-thresholds.json" with { type: "json" };

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

/* ------------------------------------------------------------------------ *
 * The evidence contract (ML_CONTRACT=2): the model returns evidence, the
 * website decides.
 * ------------------------------------------------------------------------ */

/*
 * Everything above answers the legacy contract, where the model service chose
 * the label list from the category and banded its own answer. Under the
 * evidence contract (apps/ml/contract.py) it does neither: it scores the photo
 * against every accepted Taiwan taxon, adds each subspecies into its species,
 * and returns the top 50 species as {taicol_id, score}. Which of those a page
 * may name, how sure the model must be, and what happens next are decided
 * here, against live `taxa` rows — so a species fix in the database reaches
 * the classifier the moment it is made, without rebuilding the model's files.
 *
 * One model, three rule sets. The research behind that choice, and every
 * number below, is in docs/ai-rollout.md.
 */

/**
 * The three rule sets. Named for what they judge, not for a page: the stored
 * `injured` category is filed from the roadkill page and judged as roadkill.
 */
export type Profile = "roadkill" | "wildlife" | "invasive";

/**
 * Which rule set each stored category is judged by.
 *
 * `injured` uses the roadkill set. The legacy contract could not allow that: it
 * scored the photo only against the category's list, so a list without the
 * stranded sea turtle forced the turtle's probability onto some land animal,
 * and a confident wrong answer was published under that animal's blur. Here
 * the score is a share of every Taiwan taxon, so leaving an animal off the
 * roadkill set drops its share rather than handing it to another one — and
 * the roadkill set keeps every protected animal and every animal TaiRON has
 * recorded on a road, turtles and dolphins among them.
 *
 * A category missing from this table is judged by the wildlife set and, being
 * missing from AUTO_ASSIGN_CATEGORIES too, is only ever a suggestion.
 */
export const PROFILE_OF_CATEGORY: Readonly<Record<string, Profile>> = {
  roadkill: "roadkill",
  injured: "roadkill",
  sighting: "wildlife",
  invasive: "invasive",
};

export function profileOf(category: string): Profile {
  return PROFILE_OF_CATEGORY[category] ?? "wildlife";
}

export type Band = "high" | "medium" | "low";

/**
 * A profile's cutoffs, fitted by apps/ml/evaluate.py and committed with the
 * measurements they rest on in classifier-thresholds.json.
 *
 * - `high`       the lowest score at which the model's species was right at
 *                least `targetPrecision` of the time on this profile's own
 *                photographs; null when no score got there.
 * - `medium`     below this the top 5 is mostly wrong, and is not shown.
 * - `autoAssign` whether this profile may name a species at all. The team's
 *                rule: only where it is proven right at least 95% of the time.
 */
export type ProfileThresholds = {
  high: number | null;
  medium: number;
  autoAssign: boolean;
};

type ThresholdsFile = {
  modelVersion: string;
  targetPrecision: number;
  profiles: Record<Profile, ProfileThresholds & Record<string, unknown>>;
  neverAutoAssignClasses: string[];
};

const FITTED = thresholds as unknown as ThresholdsFile;

/** The model the thresholds were measured on. Any other gets no auto-assignment. */
export const THRESHOLDS_MODEL_VERSION: string = FITTED.modelVersion;

export const PROFILE_THRESHOLDS: Readonly<Record<Profile, ProfileThresholds>> = {
  roadkill: pick(FITTED.profiles.roadkill),
  wildlife: pick(FITTED.profiles.wildlife),
  // Never, whatever the file says. An invasive answer is a suggestion for a
  // person to confirm (PR #77); a look-alike taken for an invasive species is
  // a native animal published as a pest, and for 八哥 or 金龜 a protected one.
  invasive: { ...pick(FITTED.profiles.invasive), autoAssign: false },
};

function pick(p: ProfileThresholds): ProfileThresholds {
  return { high: p.high, medium: p.medium, autoAssign: p.autoAssign };
}

/**
 * Classes the model never names by itself, whatever the score.
 *
 * Land crabs are 6% of TaiRON's records and the model's worst group. On the
 * dead-animal set it named the right crab 34 times in 119 (29%; the right one
 * was in its top 5 about half the time). evaluate.py lifts a class from this
 * list only when it clears the same 95% bar as everything else; see `crabs`
 * in the thresholds file.
 */
export const NEVER_AUTO_ASSIGN_CLASSES: ReadonlySet<string> = new Set(
  FITTED.neverAutoAssignClasses,
);

export function bandOf(profile: Profile, score: number): Band {
  const t = PROFILE_THRESHOLDS[profile];
  if (t.high !== null && score >= t.high) return "high";
  return score >= t.medium ? "medium" : "low";
}

/** One of the model's top-50 species, resolved to its live `taxa` row. */
export type Candidate = {
  /** `taxa.id` of the accepted species row: what `classifications` and `reports` hold. */
  taxonId: number;
  taicolId: string;
  scientificName: string;
  /** The model's probability for the species, as a share of every Taiwan taxon. */
  score: number;
  kingdom: string | null;
  className: string | null;
  isInvasive: boolean;
  /**
   * The species is not tagged invasive but a subspecies under it is: 環頸雉,
   * whose endemic subspecies is protected and whose introduced ones are not,
   * or the red-eared slider inside Trachemys scripta. A photograph cannot say
   * which, so it is neither "invasive" nor "native".
   */
  hasInvasiveInfraspecific: boolean;
  isMarine: boolean | null;
  isTerrestrial: boolean | null;
  isProtected: boolean;
  /** TaiRON's own dataset holds a roadkill or injured record of this species. */
  recordedOnRoads: boolean;
};

/**
 * Marine only, by TaiCOL's habitat flags. A missing flag is not "marine":
 * absent data must not drop a species.
 */
export function isMarineOnly(c: Candidate): boolean {
  return c.isMarine === true && c.isTerrestrial !== true;
}

/**
 * Whether a profile may name this species at all.
 *
 * Every profile: animals only. Scored against the whole checklist a photo of
 * an owl once came back as a cypress in the high band, and no report page is
 * for plants, fungi or bacteria.
 *
 * Roadkill, additionally: not a marine-only animal, since a fish cannot be on
 * a road — except that the habitat flags are wrong exactly where it matters.
 * 凶狠圓軸蟹 Cardisoma carnifex, a land crab with 272 TaiRON road records,
 * is flagged marine and not terrestrial, and so are 紅螯螳臂蟹 (47) and most
 * of the other crabs TaiRON finds on roads. So an animal TaiRON has recorded
 * on a road stays in whatever its flags say, and so does every protected
 * animal, because a sea turtle does cross a coastal road.
 *
 * Dropping a species here never moves its probability to another one: scores
 * are shares of every Taiwan taxon, fixed before any of this runs.
 */
export function mayBeNamedAs(profile: Profile, c: Candidate): boolean {
  if (c.kingdom !== "Animalia") return false;
  if (profile === "roadkill")
    return !isMarineOnly(c) || c.isProtected || c.recordedOnRoads;
  return true;
}

/** How many suggestions a report keeps: the list a reporter is shown. */
export const SHOWN = 5;

export type InvasiveVerdict = "suspected" | "mixed" | "native";

export type EvidenceDecision = {
  profile: Profile;
  action: ClassifierAction;
  band: Band;
  /** The profile's top answer, or null when nothing on the list may be named. */
  best: Candidate | null;
  /** Kept as `classifications` rows: the suggestions the reporter may see. */
  shown: Candidate[];
  /** Invasive profile only: what the top answer says about the animal. */
  invasive: InvasiveVerdict | null;
  /** For `reports.flagged_reason`, read by a moderator; null when nothing to say. */
  reason: string | null;
};

const nameOf = (c: Candidate) => c.scientificName;

/**
 * The whole rule, for one report.
 *
 * Scores are used exactly as the model gave them. They are never re-normalised
 * over what a profile keeps: with plants dropped from a photo of a plant, the
 * best remaining animal might hold 0.01 of the mass, and re-normalising would
 * make that 1.0 and name it in the high band.
 */
export function decideFromEvidence(input: {
  category: string;
  /** Resolved candidates, any order; unresolved ids are simply absent. */
  candidates: Candidate[];
  humanIdentified: boolean;
  /** The model version the response reported. */
  modelVersion: string;
}): EvidenceDecision {
  const profile = profileOf(input.category);
  const pool = input.candidates
    .filter((c) => mayBeNamedAs(profile, c))
    .sort((a, b) => b.score - a.score || a.taicolId.localeCompare(b.taicolId));
  const best = pool[0] ?? null;
  const band: Band = best ? bandOf(profile, best.score) : "low";
  const shown = pool.slice(0, SHOWN);

  const invasive: InvasiveVerdict | null =
    profile !== "invasive" || !best
      ? null
      : best.isInvasive
        ? "suspected"
        : best.hasInvasiveInfraspecific
          ? "mixed"
          : "native";

  const base = { profile, band, best, shown, invasive };

  // A person looked at the animal; the model looked at a photograph.
  if (input.humanIdentified) return { ...base, action: "record", reason: null };
  if (!best)
    return { ...base, action: "suggest", reason: "model could not identify this with any confidence" };

  if (profile === "invasive") {
    const reason =
      band === "low"
        ? "model could not identify this with any confidence"
        : invasive === "suspected"
          ? `the model suspects the invasive ${nameOf(best)}; a person must confirm`
          : invasive === "mixed"
            ? `the model suggests ${nameOf(best)}, which has native and introduced forms; needs an expert`
            : `the model thinks this looks like a native animal (${nameOf(best)}); a person must confirm`;
    return { ...base, action: "suggest", reason };
  }

  // On any page, an answer that says "invasive" is for a person to confirm.
  // A record's species decides whether it is in the invasive database, so an
  // invasive species named by the model files the record there with nobody
  // having looked — and look-alikes are where the model is most sure and most
  // wrong: on the live set a native 布氏樹蛙 scored 0.979 as the invasive
  // 斑腿樹蛙 under the wildlife rule set too.
  const saysInvasive = best.isInvasive || best.hasInvasiveInfraspecific;

  const assignable =
    band === "high" &&
    AUTO_ASSIGN_CATEGORIES.has(input.category) &&
    PROFILE_THRESHOLDS[profile].autoAssign &&
    !NEVER_AUTO_ASSIGN_CLASSES.has(best.className ?? "") &&
    !saysInvasive &&
    input.modelVersion === THRESHOLDS_MODEL_VERSION;
  if (assignable) return { ...base, action: "assign", reason: null };

  const reason =
    band === "low"
      ? "model could not identify this with any confidence"
      : band === "medium"
        ? "low confidence identification"
        : input.modelVersion !== THRESHOLDS_MODEL_VERSION
          ? `the thresholds were fitted for ${THRESHOLDS_MODEL_VERSION}, not ${input.modelVersion}; suggestions only`
          : NEVER_AUTO_ASSIGN_CLASSES.has(best.className ?? "")
            ? `the model only suggests ${best.className} species`
            : saysInvasive
              ? `the model suggests ${nameOf(best)}, which is or includes an invasive form; a person must confirm`
              : "the model only suggests a species for this kind of report";
  return { ...base, action: "suggest", reason };
}

/** precision_rank() from migration 0003: stricter is larger; anything else is exact. */
const PRECISION_RANK: Readonly<Record<string, number>> = {
  exact: 0,
  coarse_10km: 1,
  coarse_50km: 2,
  suppressed: 3,
};
export const precisionRank = (p: string | null | undefined): number =>
  PRECISION_RANK[p ?? ""] ?? 0;

/**
 * The blur each shown species would be published at if named: the strictest
 * row sharing its binomial (binomial_precision, 0014). `$1` is a text[] of
 * TaiCOL ids. Five calls, not fifty: binomial_precision scans `taxa` by name
 * and takes about 60 ms, so it is asked only about the list a report keeps,
 * and only when the model is about to name a species.
 */
export const BLUR_OF_SHOWN_SQL = `
select taicol_id, binomial_precision(id) as blur
  from taxa
 where taicol_id = any($1::text[])
   and taxon_status = 'accepted'
`;

/**
 * One more condition on the model naming a species by itself: no species of
 * the same genus on the list it would show needs a stricter blur.
 *
 * A wrong name is published at the named species' blur. Without this rule,
 * at the first roadkill threshold fitted (0.969), the model would have named
 * 155 of the dead-animal photographs by itself; 2 were wrong, and one of them
 * was 紅頭綠鳩 Treron formosae, protected (class II), named as the
 * unprotected Treron sieboldii at 0.981 — its location would have gone out
 * exact. The true species was on the list the model returned, as look-alikes
 * usually are, and it was a congener, as look-alikes usually are. Refusing whenever ANY stricter
 * species was in the top five would have caught it too, at the cost of 85 of
 * the 155 names; within the genus it cost 11. Those reports are not lost:
 * they become suggestions, blurred as hard as the strictest species shown
 * (suggestionOverride). The thresholds in the file are fitted with this rule
 * applied.
 */
export function guardCongeners(
  decision: EvidenceDecision,
  blurOf: ReadonlyMap<string, string | null>,
): EvidenceDecision {
  const { best } = decision;
  if (decision.action !== "assign" || !best) return decision;
  const genus = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const own = precisionRank(blurOf.get(best.taicolId));
  const stricter = decision.shown.find(
    (c) =>
      c.taicolId !== best.taicolId &&
      genus(c.scientificName) === genus(best.scientificName) &&
      precisionRank(blurOf.get(c.taicolId)) > own,
  );
  if (!stricter) return decision;
  return {
    ...decision,
    action: "suggest",
    reason: `the model is sure of ${nameOf(best)}, but lists ${nameOf(stricter)}, which is blurred more strictly; a person must confirm`,
  };
}

/** 'genus epithet', lower-cased: what a photograph can tell apart (binomial_of, 0014). */
export function binomialOf(name: string): string {
  const [genus = "", epithet = ""] = name.trim().split(/\s+/);
  return `${genus} ${epithet}`.toLowerCase();
}

/**
 * Whether the model, confident, names a different species from the person.
 *
 * At the binomial: the model names species, and a reporter who picked
 * 白頭翁's subspecies agrees with a model that says 白頭翁.
 */
export function disagreesWithPerson(decision: EvidenceDecision, personName: string | null): boolean {
  return (
    decision.best !== null &&
    personName !== null &&
    decision.band === "high" &&
    binomialOf(decision.best.scientificName) !== binomialOf(personName)
  );
}

/* ------------------------------------------------------------------------ *
 * Talking to the model service
 * ------------------------------------------------------------------------ */

/**
 * Which contract the worker asks the model service for.
 *
 * The legacy one unless ML_CONTRACT is exactly "2". The switch exists so the
 * rollout has an order that is safe at every step: the model service learns
 * to answer both, then the website that can read the new one is deployed, and
 * only then is the switch flipped. Flipping it early is safe too, just not
 * useful: the old service answers a request with no category with a 400, the
 * job is retried, and after five tries the report is held blurred as
 * "classification unavailable" rather than published under a guess.
 */
export function mlContract(env: Record<string, string | undefined>): 1 | 2 {
  return env.ML_CONTRACT?.trim() === "2" ? 2 : 1;
}

export type EvidenceResponse = {
  contract: 2;
  candidates: { taicol_id: string; score: number }[];
  detectorHit: boolean;
  modelVersion: string;
  speciesCount?: number;
};

/**
 * The model service's answer, checked to be the evidence contract.
 *
 * Thrown rather than coerced: a legacy answer read as evidence has no
 * `candidates`, would resolve to nothing, and would look exactly like "the
 * model could not identify this" — every report published as unidentified,
 * with nothing anywhere saying the service is the wrong version.
 */
export function parseEvidence(body: unknown): EvidenceResponse {
  const b = body as Partial<EvidenceResponse> | null;
  if (!b || b.contract !== 2 || !Array.isArray(b.candidates))
    throw new Error(
      "model endpoint did not answer in contract 2 — is the deployed service older than the website? (docs/ai-rollout.md)",
    );
  for (const c of b.candidates) {
    if (typeof c?.taicol_id !== "string" || typeof c?.score !== "number" || !Number.isFinite(c.score))
      throw new Error("model endpoint returned a malformed candidate");
  }
  if (typeof b.modelVersion !== "string") throw new Error("model endpoint returned no modelVersion");
  return b as EvidenceResponse;
}

/**
 * Resolve the model's TaiCOL ids to live `taxa` rows, with the facts each
 * profile's rule reads. Accepted rows only: a name TaiCOL has since retired is
 * not an answer anyone should be given, and it simply drops out of the list.
 *
 * `$1` is a text[] of TaiCOL ids. apps/ml/evaluate.py runs the same query to
 * fit the thresholds (test/classify-evidence.test.mjs holds the two equal),
 * because thresholds fitted on different candidates are thresholds for a
 * different rule.
 *
 * `recorded_on_roads` counts TaiRON's dataset only (`source = 'gbif'`), which
 * its volunteers and staff vetted, and not reports filed here, so one mistaken
 * report cannot open the roadkill list to a fish.
 */
export const RESOLVE_CANDIDATES_SQL = `
select t.id, t.taicol_id, t.scientific_name, t.kingdom, t.class,
       t.is_invasive, t.is_marine, t.is_terrestrial,
       t.protected_status is not null as is_protected,
       exists (select 1 from taxa s
                where s.id in (select taxon_and_inheritors(t.taicol_id))
                  and s.id <> t.id
                  and s.is_invasive
                  and s.taxon_status = 'accepted') as has_invasive_infraspecific,
       exists (select 1 from reports r
                where r.taxon_id in (select taxon_and_inheritors(t.taicol_id))
                  and r.source = 'gbif'
                  and r.category in ('roadkill', 'injured')) as recorded_on_roads
  from taxa t
 where t.taicol_id = any($1::text[])
   and t.taxon_status = 'accepted'
`;

export type ResolvedRow = {
  id: number;
  taicol_id: string;
  scientific_name: string;
  kingdom: string | null;
  class: string | null;
  is_invasive: boolean;
  is_marine: boolean | null;
  is_terrestrial: boolean | null;
  is_protected: boolean;
  has_invasive_infraspecific: boolean;
  recorded_on_roads: boolean;
};

/** Join the model's scores to the rows RESOLVE_CANDIDATES_SQL returned. */
export function toCandidates(evidence: EvidenceResponse, rows: ResolvedRow[]): Candidate[] {
  const byTaicol = new Map(rows.map((r) => [r.taicol_id, r]));
  const out: Candidate[] = [];
  for (const c of evidence.candidates) {
    const r = byTaicol.get(c.taicol_id);
    if (!r) continue;
    out.push({
      taxonId: r.id,
      taicolId: r.taicol_id,
      scientificName: r.scientific_name,
      score: c.score,
      kingdom: r.kingdom,
      className: r.class,
      isInvasive: r.is_invasive,
      hasInvasiveInfraspecific: r.has_invasive_infraspecific,
      isMarine: r.is_marine,
      isTerrestrial: r.is_terrestrial,
      isProtected: r.is_protected,
      recordedOnRoads: r.recorded_on_roads,
    });
  }
  return out;
}
