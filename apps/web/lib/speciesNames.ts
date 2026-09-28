/**
 * How a species is named on the page: which name leads, which follows, and in
 * what language each one is.
 *
 * The team asked for the English name beside the Chinese one. Every page used
 * to decide this for itself, with a `zhFirst ? common : scientific` ternary of
 * its own, and they disagreed: on /en the directory led with the scientific
 * name and set the Chinese in italics, the record page led with the Chinese,
 * and nothing anywhere showed English, because the database had none until
 * migration 0015. One function now answers for every page.
 *
 * The rule, in both locales: the page's own language first, the other beside
 * it, the scientific name after them.
 *
 *   zh-TW   黑眶蟾蜍 · Asian Common Toad   Duttaphrynus melanostictus
 *   en      Asian Common Toad · 黑眶蟾蜍   Duttaphrynus melanostictus
 *
 * A missing name is simply absent: no dash, no "no English name", and never a
 * machine translation (english-names.json leaves a name out rather than guess).
 * When the page's language has no name, the scientific name leads rather than
 * the other language's common name, so an English reader never sees a lone
 * Chinese headline they cannot read and a Chinese reader never sees an English
 * one; the other name still follows.
 *
 * Only the scientific name is italic. Hanzi set in italics is a synthesised
 * slant that no Chinese typeface draws, and English common names are not
 * italicised in any field guide.
 */

import { displayNameZh } from "./speciesNotes.ts";

export type NameFields = {
  scientificName: string;
  commonNameZh: string | null;
  commonNameEn?: string | null;
  /** Lets a curated Chinese name replace a misleading one (lib/speciesNotes.ts). */
  taicolId?: string | null;
};

/** BCP 47 tags for the `lang` attribute. Traditional Chinese, English, Latin. */
export type NameLang = "zh-Hant" | "en" | "la";

export type NamePart = { text: string; lang: NameLang; italic: boolean };

export type SpeciesNames = {
  /** The headline: the page's language if there is a name in it, else the scientific name. */
  primary: NamePart;
  /** The other language's common name, when there is one and it differs. */
  other: NamePart | null;
  /** The scientific name, unless it is already the headline. */
  scientific: NamePart | null;
};

const blank = (s: string | null | undefined) => !s || !s.trim();

export function speciesNames(s: NameFields, locale: string): SpeciesNames {
  const zhName = displayNameZh(s.taicolId, s.commonNameZh);
  const zh: NamePart | null = blank(zhName)
    ? null
    : { text: zhName!.trim(), lang: "zh-Hant", italic: false };
  const en: NamePart | null = blank(s.commonNameEn)
    ? null
    : { text: s.commonNameEn!.trim(), lang: "en", italic: false };
  const sci: NamePart = { text: s.scientificName, lang: "la", italic: true };

  const [own, foreign] = locale === "en" ? [en, zh] : [zh, en];
  return {
    primary: own ?? sci,
    other: foreign,
    scientific: own ? sci : null,
  };
}

/**
 * The names as one line of plain text, for a <title>, an alt text or an
 * aria-label, where there is no markup to carry the language: "黑眶蟾蜍 Asian
 * Common Toad" or "Asian Common Toad (黑眶蟾蜍)". The scientific name is left
 * out unless it is the only name, to keep titles short.
 */
export function speciesLabel(s: NameFields, locale: string): string {
  const n = speciesNames(s, locale);
  if (!n.other) return n.primary.text;
  return locale === "en"
    ? `${n.primary.text} (${n.other.text})`
    : `${n.primary.text} ${n.other.text}`;
}
