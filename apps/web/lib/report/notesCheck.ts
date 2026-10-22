import { LOCATION_REASONS, normalise, screenText } from "../forum/screen.ts";

/**
 * What in a report's notes would be better left out, said while it is typed.
 *
 * The notes are public on every record shown at its exact place, and that is
 * now every report naming an invasive animal as well as the ones nobody needs
 * to blur. Most reporters are high-school students, and the form gave no hint
 * of it: a note saying which school someone is at, or what their LINE id is,
 * went up beside the record for anyone to read.
 *
 * A warning, never a refusal. The form says what it noticed and the reporter
 * decides; the server's own screen (screenSubmission in lib/abuse.ts) still
 * holds a report whose notes carry a location or contact details for a
 * moderator, whatever was said here. So these patterns lean towards noticing:
 * a false match costs one sentence on screen.
 *
 * Pure, so the cases can be tested as a table (test/notes-check.test.mjs).
 */

/** Keys under `report.notesWarning`, most serious first. */
export type NotesConcern = "location" | "contact" | "address" | "school";

/**
 * The links lib/abuse.ts holds in the notes, and handles more widely than it
 * does. The server holds `@[a-z0-9_]{4,}`; here any @name of two or more
 * characters, in any script and with dots (Instagram allows them), and
 * straight after other text too, as in "IG@lin.xiao". An email address
 * matches as well, which is the same warning.
 */
const LINK_OR_HANDLE = /https?:\/\/|www\.|\bt\.me\b|@[\p{L}\p{N}_.]{2,}/u;

/** Digits as a Chinese address writes them, Arabic or Chinese. */
const NUMBER = "[\\d一二三四五六七八九十百千零〇兩]+";

/**
 * The shapes a street address takes, not the words in it.
 *
 * A bare 路 is in 路殺, 馬路, 路邊 and 公路, which is to say in most roadkill
 * notes, and a bare 街 is a street name, which says where the animal was and
 * nothing about the reporter. What gives a home away is the numbering: a lane,
 * an alley or a house number (15巷3弄8號), or a road or street followed by its
 * section or its number (中正路二段, 民生街100). National freeways are named
 * by number too (國道3號) and are left alone. English forms are the ones a
 * Taiwanese address takes in English: "No. 8", "Lane 15", "Sec. 2".
 */
const ADDRESS: RegExp[] = [
  // From the start of the number, so 國道10號 is not read as "0號".
  new RegExp(`(?<!國道\\s*|${NUMBER})${NUMBER}\\s*(?:巷|弄|號|号)`, "u"),
  new RegExp(`(?:路|街|大道)\\s*${NUMBER}\\s*段`, "u"),
  // A road or street and then a number, unless the number is a distance, a
  // time or a count: "公路 50 公尺處" and "路邊 3 隻" are where, not who.
  /(?:路|街)\s*\d{1,4}(?![\d.]|\s*(?:公里|公尺|米|km|m\b|k\b|分|點|時|度|°|隻|只|年|月|日|cm|公分))/u,
  /\bno\.\s*\d+/,
  /\b(?:lane|ln|alley|aly)\.?\s*\d+/,
  /\bsec(?:tion|\.)?\s*\d/,
];

/**
 * Words that name a school, or a kind of one. 大學 also matches 大學生, and
 * is meant to: "a student at 某某大學" is the sentence being looked for, and a
 * reporter who only wrote that they are a student can ignore one line.
 */
const SCHOOL =
  /國小|國中|高中|高職|中學|小學|大學|附中|女中|\b(?:elementary|primary|middle|junior high|senior high|high) school\b|\buniversity\b/u;

/** What in these notes is worth a second look, most serious first. */
export function notesConcerns(input: string): NotesConcern[] {
  if (!input.trim()) return [];
  const { reasons } = screenText(input, { watchedWords: [], newAccount: false });
  const text = normalise(input);
  const found: NotesConcern[] = [];
  if (reasons.some((r) => LOCATION_REASONS.includes(r))) found.push("location");
  if (reasons.includes("contact") || LINK_OR_HANDLE.test(text)) found.push("contact");
  if (ADDRESS.some((re) => re.test(text))) found.push("address");
  if (SCHOOL.test(text)) found.push("school");
  return found;
}
