// `with { type: "json" }` is not decoration: `node --test` type-strips this
// file to run `test/lab.test.mjs` against it, and Node refuses a JSON import
// without the attribute. Next reads it the same way.
import charset from "../../public/lab/fonts/charset.json" with { type: "json" };

import type { LabDirection } from "./directions";

/**
 * What the lab's display faces can and cannot draw, and what to do about it.
 *
 * `scripts/lab-subset-fonts.mjs` cuts Noto Sans TC Black and Noto Serif TC Bold
 * down to the characters the lab actually sets — the two message catalogues,
 * `lib/lab/copy.ts`, Basic Latin and the four species the lab's routes name —
 * and publishes the result as `public/lab/fonts/charset.json`. This module is
 * the read side of that file, so the decision below is made from the same list
 * the bytes were cut from rather than from a second list that can drift.
 */

/** Which family each direction's headings are set in (see fonts.css). */
const FAMILY_FOR: Record<LabDirection, keyof typeof charset.families> = {
  roundel: "sign",
  journal: "ming",
};

/**
 * The one face worth preloading, per direction: Basic Latin plus the chrome and
 * home Hanzi.
 *
 * Preloaded on the LAB HOME ONLY. A preload is a fetch, so putting this in the
 * layout would hand the map route a font request and break the budget that route
 * exists to hold — direction.md §2.6 rule 8. The other two faces are never
 * preloaded: `unicode-range` already tells the browser which of them a page
 * needs, and telling it twice just moves the cost earlier.
 */
export const LAB_FONT_PRELOAD: Record<LabDirection, string> = {
  roundel: facePath("roundel", "home"),
  journal: facePath("journal", "home"),
};

function facePath(direction: LabDirection, group: string): string {
  const family = charset.families[FAMILY_FOR[direction]];
  const face = family.faces.find((f) => f.id.endsWith(`-${group}`));
  if (!face) throw new Error(`no ${group} face for ${direction}`);
  return `/lab/fonts/${face.file}`;
}

/**
 * Every code point any lab face can draw, as sorted [first, last] pairs.
 *
 * Built once from the published `unicode-range`, which is the same string the
 * `@font-face` blocks carry, so this answers exactly what the browser would.
 */
const COVERED: ReadonlyArray<readonly [number, number]> = charset.covered
  .split(",")
  .map((part) => {
    const [first, last] = part.trim().replace(/^U\+/i, "").split("-");
    const start = parseInt(first, 16);
    return [start, last === undefined ? start : parseInt(last, 16)] as const;
  });

function covers(point: number): boolean {
  let low = 0;
  let high = COVERED.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const [start, end] = COVERED[mid];
    if (point < start) high = mid - 1;
    else if (point > end) low = mid + 1;
    else return true;
  }
  return false;
}

/** Can the display faces draw every character of this string? */
export function inLabCharset(text: string): boolean {
  for (const character of text) {
    const point = character.codePointAt(0);
    if (point === undefined) continue;
    // A space, a newline or anything else the layout supplies rather than the
    // content is not a reason to drop a title out of its typeface.
    if (point <= 0x20) continue;
    if (!covers(point)) return false;
  }
  return true;
}

/**
 * The class a title gets: nothing, or the one that drops it to the system face.
 *
 * ALL OR NOTHING, PER TITLE (direction.md §2.2). `unicode-range` means an
 * uncovered character is drawn by the system font rather than lost, which is
 * the right answer inside a paragraph and the wrong one in an h1: at 56px, one
 * system glyph among six subset ones reads as a bug in the page, not as a gap
 * in a font. Taiwan's checklist is tens of thousands of Hanzi against a subset
 * of about eight hundred, so this is a case that will happen, not a hypothesis.
 *
 * Call it with the string, not with the node:
 *
 *   <PageTitle size="hero" className={labFaceClass(name)}>{name}</PageTitle>
 *
 * It is cheap — a binary search per character — and safe to call during render.
 */
export function labFaceClass(text: string): "" | "face-system" {
  return inLabCharset(text) ? "" : "face-system";
}

/** For tests and for anyone checking what the subsets actually cover. */
export const LAB_CHARSET_SIZE = charset.coveredCount;
