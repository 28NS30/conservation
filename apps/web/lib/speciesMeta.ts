/**
 * Which description a species page gives a search result or a shared link.
 *
 * It was one sentence with the public record count in it, for every species.
 * A species TaiCOL rates 座標不開放 has no rows in the public view at all, so
 * its count is 0 whether or not anyone has recorded it, and its description
 * said "（0 筆）" — the same false "nothing here" the page itself was changed
 * not to say (see `withheld` on the species page). It gets a sentence of its
 * own, with no count and no claim about records either way.
 *
 * A species nobody has reported says so in words: "0 筆" read as a broken
 * page, and the page body already says "nobody has reported this species
 * here yet".
 *
 * Returns the catalogue key and its values rather than the sentence, so the
 * page's translator words it and a test can hold the choice without one.
 */
export type SpeciesDescription =
  | { key: "metaDescriptionWithheld"; values: { name: string } }
  | { key: "metaDescriptionNone"; values: { name: string } }
  | { key: "metaDescription"; values: { name: string; count: number } };

export function speciesDescription(
  s: { sensitivity: string | null; reportCount: number },
  name: string,
): SpeciesDescription {
  if (s.sensitivity === "座標不開放") return { key: "metaDescriptionWithheld", values: { name } };
  if (s.reportCount <= 0) return { key: "metaDescriptionNone", values: { name } };
  return { key: "metaDescription", values: { name, count: s.reportCount } };
}
