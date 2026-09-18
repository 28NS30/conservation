import type { Category } from "@conservation/shared";

/**
 * The stored category, computed from two answers a person can actually give.
 *
 * This function is the whole argument for the redesign, so it is the first
 * thing in the report directory rather than a detail inside a form.
 *
 * Today the form opens by asking which of three report types this is, and the
 * answer decides `category` directly. That question cannot be answered well: a
 * reporter standing over a dead animal has to work out whether the site files
 * it under "roadkill or injured" or "invasive species", and the form has a
 * silent default that files anything unanswered as roadkill — which is how
 * injured animals end up in the dataset as dead ones. `category` is a
 * database column pretending to be a question.
 *
 * So the flow stops asking. It asks what a person at the roadside knows: what
 * condition the animal was in, and what animal it was. Category falls out.
 * Condition wins over species, always — a dead invasive is roadkill, because
 * "something was killed on this road" is what the record is for and an
 * invasive count that includes corpses is a different measurement.
 *
 * The truth table is report-flow.md's, transcribed row for row; the test walks
 * it. Pure, and deliberately so: the same function has to serve the direct
 * submission, the offline queue, and — when a moderator later confirms what the
 * animal was — the re-derivation that turns a `sighting` of a confirmed
 * invasive into an `invasive`.
 */
export type Condition = "dead" | "hurt" | "well";

/**
 * What the flow knows about the species, in the only three shapes step 4 can
 * produce: a name the reporter chose, an admission that they do not know, or a
 * search that never answered.
 */
export type SpeciesAnswer =
  | {
      kind: "named";
      id: number;
      scientificName: string;
      commonNameZh: string | null;
      /** TaiCOL's flag. `null` is a real answer: the register does not say. */
      isInvasive: boolean | null;
    }
  /** "Not sure", optionally with "but I think it's introduced". */
  | { kind: "unsure"; introduced: boolean }
  /** The search was offline or slow and the reporter moved on. */
  | { kind: "skipped" };

export type Derivation = {
  /** TaiCOL's invasive flag for a named taxon; `null` when nobody named one. */
  taxonIsInvasive: boolean | null;
  /** The reporter said "introduced", or arrived on an `?category=invasive` link. */
  saysIntroduced: boolean;
};

export function deriveCategory(
  condition: Condition,
  { taxonIsInvasive, saysIntroduced }: Derivation,
): Category {
  // Condition first, and it is final. Both of these ignore the species
  // entirely: a dead animal is a roadkill record whatever it was, and a hurt
  // one is an injured record whatever it was.
  if (condition === "dead") return "roadkill";
  if (condition === "hurt") return "injured";

  // Alive and well. Now the species decides, and a named taxon outranks what
  // the reporter believes about it — including the belief carried in by an
  // `?category=invasive` link, which is why a named native is a `sighting`
  // even when the reporter arrived through the invasive-species door.
  if (taxonIsInvasive === true) return "invasive";
  if (taxonIsInvasive === false) return "sighting";

  // Nobody named a taxon, or the register has no opinion about the one that
  // was named. The reporter's own "I think it's introduced" is all there is.
  return saysIntroduced ? "invasive" : "sighting";
}

/** What `deriveCategory` needs, read off a species answer. */
export function derivationFor(
  species: SpeciesAnswer | null,
  arrivedAsInvasive = false,
): Derivation {
  if (species?.kind === "named")
    return {
      taxonIsInvasive: species.isInvasive,
      saysIntroduced: arrivedAsInvasive,
    };
  return {
    taxonIsInvasive: null,
    saysIntroduced:
      arrivedAsInvasive || (species?.kind === "unsure" && species.introduced),
  };
}

/**
 * Where the stored taxon came from, which is not the same question as which
 * category it produced.
 *
 * `null` for a skipped search is meaningful: "the reporter was never able to
 * answer" is a different record from "the reporter said they did not know",
 * and only the second is evidence that identification is hard.
 */
export function taxonSource(
  species: SpeciesAnswer | null,
): "user" | "unknown" | null {
  if (species?.kind === "named") return "user";
  if (species?.kind === "unsure") return "unknown";
  return null;
}
