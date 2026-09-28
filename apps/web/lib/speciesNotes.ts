/**
 * What TaiCOL's data says wrongly or not at all about a handful of taxa, and
 * what the site says instead. The team's request 13; each entry was checked
 * against TaiCOL's own pages by two researchers (roadmap, "species fixes").
 *
 * Keyed by TaiCOL id, not taxa.id, because a fresh import renumbers taxa.id.
 * Display only: nothing here changes a record, a blur or a search result, and
 * the TaiCOL import never overwrites it, which is why it lives in the code and
 * not in `taxa`.
 */

export type SpeciesNoteKey = "introducedMainIsland" | "nameUnderReview";

type Entry = {
  /** A Chinese name to show instead of TaiCOL's. */
  commonNameZh?: string;
  notes?: SpeciesNoteKey[];
};

export const SPECIES_NOTES: Record<string, Entry> = {
  /*
   * Two species share the Chinese name 緬甸蟒. TaiCOL gives it to the Burmese
   * python, Taiwan's snake, and also to this row, the Indian python, which is
   * not in Taiwan and which the law protects as class I. 亞洲岩蟒 (Asian rock
   * python) is the name for it that cannot be mistaken for Taiwan's.
   */
  t0102070: { commonNameZh: "亞洲岩蟒" },

  /*
   * Native to Kinmen and Matsu, introduced on Taiwan's main island. TaiCOL
   * records one alien status for all three together, "native", and keeps the
   * difference in a note ("臺灣: 引進種") that our import does not carry. The
   * roadmap's question 8: label them, and keep them out of the invasive
   * collection.
   */
  t0084390: { notes: ["introducedMainIsland"] }, // 喜鵲 Pica serica
  t0097785: { notes: ["introducedMainIsland"] }, // 鵲鴝 Copsychus saularis
  t0085493: { notes: ["introducedMainIsland"] }, //   its subspecies saularis
  t0064818: { notes: ["introducedMainIsland"] }, // 黑領椋鳥 Gracupica nigricollis
  t0097085: { notes: ["introducedMainIsland"] }, // 大陸畫眉 Garrulax canorus
  t0029282: { notes: ["introducedMainIsland"] }, //   its subspecies canorus

  /*
   * Names that do not apply in Taiwan, whose records a biologist has to place.
   * 日本樹蛙's 75 records are 周氏樹蛙 or 太田樹蛙 depending on where each was
   * found; the hoopoe's 13 are probably 戴勝 U. e. saturata. Migration 0022
   * moved the records whose right name was certain; these wait.
   */
  t0101610: { notes: ["nameUnderReview"] }, // Buergeria japonica
  t0102553: { notes: ["nameUnderReview"] }, // Upupa epops epops
};

export function speciesNotes(taicolId: string | null | undefined): SpeciesNoteKey[] {
  return (taicolId && SPECIES_NOTES[taicolId]?.notes) || [];
}

/** TaiCOL's Chinese name, or ours where TaiCOL's misleads. */
export function displayNameZh(taicolId: string | null | undefined, zh: string | null): string | null {
  return (taicolId && SPECIES_NOTES[taicolId]?.commonNameZh) || zh;
}
