import { TAIWAN_BOUNDS } from "@conservation/shared";

/**
 * What the forum checks in a post before anyone else can read it.
 *
 * THE REASON THIS EXISTS. The map blurs a protected animal's location to 10 or
 * 50 km, and that blur is the one promise this site makes. A forum is a way
 * round it: "saw a pangolin at 25.0330, 121.5654" publishes to the metre what
 * the map would only ever show as a 10 km square. So a post that looks like it
 * carries a location is HELD — kept from everyone but its author and the
 * moderators — until a person has read it, and the poster is pointed at the
 * report form, where the blur is applied for them.
 *
 * Holding, never refusing: a false match costs a post a short wait, and a
 * missed one cannot be taken back. That asymmetry is why the patterns below
 * lean towards matching.
 *
 * WHAT COUNTS AS A LOCATION
 *   - A pair of decimal degrees that falls inside Taiwan's bounds (the main
 *     island, Penghu, Kinmen and Matsu), in either order, with or without a
 *     comma, with N/E or 北緯/東經 or a degree sign around them — "25.03,
 *     121.56", "121.5654 25.0330", "N25.0330 E121.5654", "北緯25.03度 東經121.56度".
 *   - The same in degrees, minutes and seconds — 25°01'58"N 121°33'54"E,
 *     25度01分58秒 — or degrees and decimal minutes.
 *   - TWD97 grid coordinates, the pair Taiwan's own agencies publish.
 *   - Full-width digits and punctuation (２５．０３３０，１２１．５６５４), which is
 *     how a Chinese keyboard often types them: the text is NFKC-normalised
 *     first, so they are the same characters as ASCII by the time anything
 *     matches.
 *   - Any map link — Google Maps including its short links, Apple Maps,
 *     OpenStreetMap, Waze, Bing, geo: URIs, what3words — whatever it points
 *     at. A short link cannot be opened here to see where it goes, so every
 *     one is held, from any shortener, as a map link.
 *   - Plus Codes (7QQ32GJQ+XV, or the short 2GJQ+XV).
 *
 * A place NAME cannot be caught this way ("the second car park at 陽明山").
 * The guidelines ask people not to, and one flag for "sensitive location"
 * hides a post at once; those are the defences there.
 *
 * AND ALSO
 *   - contact details (an email address, a Taiwanese mobile number, a LINE
 *     id): the guidelines' second rule is no personal information, and most
 *     members are minors;
 *   - any link at all from an account younger than seven days, the commonest
 *     shape of spam;
 *   - a watched word, matched on word boundaries so that 樹幹 is not 幹 and a
 *     great tit is a bird.
 *
 * Pure: no database, no clock. The caller passes the watched words and the
 * account's age, and the unit tests drive it with a table of cases
 * (test/forum-screen.test.mjs), each of which fails when the rule it covers is
 * taken out.
 */

export type HoldReason =
  | "coordinates"
  | "map_link"
  | "plus_code"
  | "contact"
  | "link"
  | "watched_word"
  | "first_posts"
  | "flagged";

/** The reasons that mean "this may say where an animal is". */
export const LOCATION_REASONS: readonly HoldReason[] = ["coordinates", "map_link", "plus_code"];

export type ScreenOptions = {
  /** Lower-case words and phrases, as stored in forum_watched_words. */
  watchedWords: readonly string[];
  /** True while the account is younger than seven days: any link is held. */
  newAccount: boolean;
};

export type ScreenResult = {
  reasons: HoldReason[];
  /** What matched, for the moderator's queue. Never shown to the poster. */
  matches: string[];
};

/* ------------------------------------------------------------------ *
 * Normalising
 * ------------------------------------------------------------------ */

/**
 * Characters that draw nothing: every Unicode format character (bidi marks,
 * joiners, the tag block, U+061C, U+2066…), combining marks, and the blank
 * letters (U+3164 and its kin). A hand-picked list of zero-width characters
 * missed most of them, and one inside a number split a coordinate in two
 * (security audit, 29 September 2026).
 */
const INVISIBLE = /[\p{Cf}\p{Mn}\p{Me}\u115F\u1160\u3164\uFFA0\u2800]/gu;

/**
 * Percent-escapes of punctuation, decoded, so a search link's
 * "q=25.0330%2C121.5654" reads as the pair it is. Only punctuation and
 * spaces: decoding letters would let an escape spell a word past the filter
 * in a way it never could be read.
 */
function decodePunctuationEscapes(text: string): string {
  return text.replace(/%([0-9a-f]{2})/gi, (m, hex: string) => {
    const c = String.fromCharCode(parseInt(hex, 16));
    return /[\s,;:/°'"+.\-_~()]/.test(c) ? c : m;
  });
}

/**
 * One spelling for everything that can be spelt several ways.
 *
 * NFKC turns full-width digits, letters and punctuation into ASCII (so ２５．０３
 * is 25.03) and splits the double prime into two primes. Zero-width characters
 * are removed, because inserting one between letters is the oldest way past a
 * word filter. Then every prime, curly quote and degree look-alike collapses
 * onto ' " and °, so the coordinate patterns have one alphabet to read.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .replace(/[\u2032\u2019\u2018`\u00B4\u02B9\u02BC]/g, "'")
    .replace(/[\u2033\u201C\u201D\u02BA]/g, '"')
    .replace(/''/g, '"')
    .replace(/[\u00BA\u02DA\u2070]/g, "°")
    .replace(/[、，]/g, ",")
    // An ideographic full stop after a whole number and before digits is its
    // decimal point: NFKC keeps "。", so "２５。０３３０" would otherwise be two
    // numbers. After a number that already has one ("25.0330。121.5654") it
    // is a separator, and stays one.
    .replace(/(?<![\d.])(\d+)。(?=\d)/g, "$1.")
    .replace(/%[0-9a-f]{2}/gi, (m) => decodePunctuationEscapes(m));
}

/* ------------------------------------------------------------------ *
 * Coordinates
 * ------------------------------------------------------------------ */

const [[WEST, SOUTH], [EAST, NORTH]] = TAIWAN_BOUNDS;

function inTaiwan(a: number, b: number): boolean {
  const ok = (lat: number, lng: number) => lat >= SOUTH && lat <= NORTH && lng >= WEST && lng <= EAST;
  return ok(a, b) || ok(b, a);
}

type Token = { start: number; end: number; value: number };

/**
 * Degrees with minutes (and optionally seconds): 25°01'58", 25°01.967',
 * 25度01分58秒. Minutes are required. A bare "25°" is far more often a
 * temperature than a place, and a degree alone is 100 km, coarser than any
 * blur, so it is not worth holding a post for.
 */
const DMS = /(\d{1,3}(?:\.\d+)?)\s*(?:°|度)\s*(\d{1,2}(?:\.\d+)?)\s*(?:'|分)\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|秒))?/g;

/** A decimal number with at least one digit after the point. */
const DECIMAL = /(?<![\d.])(\d{1,3}\.\d+)(?![\d.])/g;

/** TWD97 easting (six digits) and northing (seven, 24xxxxx–28xxxxx). */
const TWD97_E = /(?<![\d.])([1-3]\d{5})(?:\.\d+)?(?![\d.])/g;
const TWD97_N = /(?<![\d.])(2[4-8]\d{5})(?:\.\d+)?(?![\d.])/g;

/**
 * What may sit between the two halves of a coordinate pair: separators,
 * hemisphere letters, degree marks, and the words people put there. Everything
 * in the gap is deleted by this pattern; if anything is left, the two numbers
 * were not a pair. So "25.03 and 121.56" is not a pair (the "a" and "d" of
 * "and" survive), and "25.03n, 121.56e" is.
 */
const GAP_NOISE =
  /latitude|longitude|long|lat|lng|lon|twd97|tm2|北緯|東經|南緯|西經|緯度|經度|緯|經|度|分|秒|至|與|和|及|到|\bto\b|[nsewxy]|[\s,;:/|()[\]{}°'"=&+_~。\-\u2010-\u2015\u2212]/g;
const MAX_GAP = 24;

function isPairGap(gap: string): boolean {
  // Whitespace counts once, however much of it there is: 25 spaces or
  // newlines between the numbers is still a pair.
  const g = gap.replace(/\s+/g, " ");
  return g.length <= MAX_GAP && g.replace(GAP_NOISE, "") === "";
}

/**
 * Two numbers each given to three or more decimal places (about 100 m or
 * finer), close together and a place in Taiwan as a pair, are a coordinate
 * whatever is written between them: "lat 25.0330 and lng 121.5654". Words
 * between two rougher numbers are left alone, so "measured 23.5 and 120.5"
 * still goes through.
 */
const PRECISE_GAP = 40;
const precise = (text: string, t: Token) => /\.\d{3,}/.test(text.slice(t.start, t.end));

function findCoordinates(text: string): string[] {
  const hits: string[] = [];

  // Degrees-minutes-seconds first, and their spans masked, so the decimal
  // minutes inside "25°01.967'" are not also read as a number of their own.
  const tokens: Token[] = [];
  for (const m of text.matchAll(DMS)) {
    const d = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const sec = Number(m[3] ?? 0);
    tokens.push({ start: m.index!, end: m.index! + m[0].length, value: d + min / 60 + sec / 3600 });
  }
  const covered = (i: number) => tokens.some((t) => i >= t.start && i < t.end);
  for (const m of text.matchAll(DECIMAL)) {
    if (covered(m.index!)) continue;
    tokens.push({ start: m.index!, end: m.index! + m[0].length, value: Number(m[1]) });
  }
  tokens.sort((a, b) => a.start - b.start);

  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    const gap = text.slice(a.end, b.start);
    const paired =
      isPairGap(gap) ||
      (precise(text, a) && precise(text, b) && gap.replace(/\s+/g, " ").length <= PRECISE_GAP);
    if (paired && inTaiwan(a.value, b.value)) hits.push(text.slice(a.start, b.end));
  }

  // TWD97: an easting and a northing next to each other, either order.
  const grid: { start: number; end: number; kind: "e" | "n" }[] = [];
  for (const m of text.matchAll(TWD97_E)) grid.push({ start: m.index!, end: m.index! + m[0].length, kind: "e" });
  for (const m of text.matchAll(TWD97_N)) grid.push({ start: m.index!, end: m.index! + m[0].length, kind: "n" });
  grid.sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < grid.length; i++) {
    const a = grid[i];
    const b = grid[i + 1];
    if (a.kind === b.kind) continue;
    if (!isPairGap(text.slice(a.end, b.start))) continue;
    hits.push(text.slice(a.start, b.end));
  }

  return hits;
}

/* ------------------------------------------------------------------ *
 * Map links and Plus Codes
 * ------------------------------------------------------------------ */

const MAP_LINKS: RegExp[] = [
  /google\.[a-z.]{2,8}\/maps/,
  /maps\.google\.[a-z.]{2,8}/,
  /goo\.gl\/maps/,
  /maps\.app\.goo\.gl/,
  /g\.co\/kgs/,
  /maps\.apple\.com/,
  /maps\.apple\//,
  /openstreetmap\.org/,
  /(?<![a-z0-9-])osm\.org/,
  /waze\.com/,
  /bing\.com\/maps/,
  /map\.baidu\.com/,
  /what3words\.com/,
  /(?<![a-z0-9-])w3w\.co/,
  /plus\.codes/,
  /(?<![a-z])geo:\s*-?\d/,
  // what3words' own notation: ///filled.count.soap, in any script.
  /\/\/\/[\p{L}]+\.[\p{L}]+\.[\p{L}]+/u,
  // Short links of every kind, whatever the account's age. Any of them can
  // point at a pinned map, and none can be opened here to see; only the map
  // services' own shorteners were held, and bit.ly or reurl.cc went through
  // from any account older than a week (security audit, 29 September 2026).
  /(?<![a-z0-9-])(?:bit\.ly|reurl\.cc|lihi\d?\.(?:cc|com|me)|tinyurl\.com|tiny\.cc|g\.page|goo\.gl|t\.co|t\.ly|is\.gd|v\.gd|x\.gd|ow\.ly|buff\.ly|pse\.is|ppt\.cc|0rz\.tw|rebrand\.ly|cutt\.ly|shorturl\.at|rb\.gy|s\.id|b23\.tv)\/\S/,
];

/** Open Location Code: 4–8 characters of its alphabet, a plus, 2–3 more. */
const PLUS_CODE = /(?<![0-9a-z+])[23456789cfghjmpqrvwx]{4,8}\+[23456789cfghjmpqrvwx]{2,3}(?![0-9a-z])/;

/* ------------------------------------------------------------------ *
 * Links and contact details
 * ------------------------------------------------------------------ */

const TLDS =
  "com|net|org|tw|io|co|me|app|ly|gl|info|xyz|link|site|online|top|cn|jp|hk|us|uk|de|edu|gov|dev|page|so|gg|tv|cc|ai|to|fm|be";
const URL_LIKE = new RegExp(
  `(?:https?:\\/\\/|www\\.)\\S+|(?<![@\\w.-])(?:[a-z0-9-]+\\.)+(?:${TLDS})(?![\\w-])(?:\\/\\S*)?`,
);

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/;
/** Taiwanese mobile numbers: 09xx-xxx-xxx, +886 9xx xxx xxx, with any separators. */
const TW_MOBILE = /(?<!\d)(?:\+?886[\s-]?|0)9\d{2}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/;
/** "LINE id: …", "line: …", "加line", "賴:" — asking to move a conversation off the site. */
const LINE_ID = /(?:(?<![a-z])line\s*(?:id)?\s*[:：=]|加\s*line|加\s*賴|賴\s*[:：])/;

/* ------------------------------------------------------------------ *
 * Watched words
 * ------------------------------------------------------------------ */

/**
 * Real animal names that contain a word a filter might watch for. Removed
 * from the text before matching English words, so a list that did one day
 * gain "tit" or "booby" still lets a bird through.
 */
export const ENGLISH_ALLOWLIST: readonly string[] = [
  "great tit", "blue tit", "coal tit", "marsh tit", "willow tit", "varied tit",
  "green-backed tit", "yellow tit", "long-tailed tit", "penduline tit",
  "bearded tit", "crested tit", "sultan tit", "fire-capped tit", "tit-babbler",
  "titmouse", "bushtit", "booby", "boobies", "brown booby", "masked booby",
  "red-footed booby", "blue-footed booby", "woodcock", "peacock", "cockatoo",
  "cockatiel", "shag", "shags", "wild ass", "dickcissel",
];

/**
 * The same for Chinese phrases: common words that contain a watched phrase.
 * 靠北 is Taiwanese profanity and also the first two characters of 靠北邊 ("keep
 * to the north side"), which is how a trail is described.
 */
export const CHINESE_ALLOWLIST: readonly string[] = [
  "靠北邊", "靠北側", "靠北部", "靠北方", "靠北面", "靠北端", "靠北岸",
];

const HAN = /\p{Script=Han}/u;
const CJK_WORD = /[\p{Script=Han}\p{Script=Bopomofo}]/u;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The text with the usual disguises taken off: runs of three or more of the
 * same letter shortened to one ("fuuuck"), and single letters spaced or dotted
 * apart joined up ("f.u.c.k", "f u c k").
 */
function undisguise(text: string): string {
  return text
    .replace(/([a-z])\1{2,}/g, "$1")
    .replace(/(?<![a-z])(?:[a-z][\s.\-_*]+){2,}[a-z](?![a-z])/g, (m) => m.replace(/[\s.\-_*]+/g, ""));
}

/** For Chinese phrases: every separator removed, so 機.掰 and 機 掰 are 機掰. */
function compactCjk(text: string): string {
  return text.replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function findWatchedWords(text: string, words: readonly string[]): string[] {
  const hits: string[] = [];

  let latin = text.replace(/\s+/g, " ");
  for (const safe of ENGLISH_ALLOWLIST) {
    latin = latin.replace(new RegExp(`(?<![a-z])${escapeRegExp(safe)}(?![a-z])`, "g"), " ");
  }
  const latinVariants = [latin, undisguise(latin)];

  let cjk = text;
  for (const safe of CHINESE_ALLOWLIST) cjk = cjk.split(safe).join(" ");
  const cjkVariants = [cjk, compactCjk(cjk)];

  for (const raw of words) {
    const word = normalise(raw).trim();
    if (!word) continue;

    if (CJK_WORD.test(word)) {
      if ([...word].length === 1 && HAN.test(word)) {
        // A single character is only a word when it stands alone: 幹 by
        // itself, not inside 樹幹, 幹部 or 幹線. Chinese has no spaces, so
        // "alone" means no Han character on either side.
        const alone = new RegExp(`(?<!\\p{Script=Han})${escapeRegExp(word)}(?!\\p{Script=Han})`, "u");
        if (alone.test(cjk)) hits.push(word);
      } else if (cjkVariants.some((v) => v.includes(word))) {
        hits.push(word);
      }
      continue;
    }

    // Latin: whole words only, so "shit" is not found in "shiitake" and "ass"
    // is not found in "grass" or "bass".
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(word)}(?![a-z0-9])`);
    if (latinVariants.some((v) => re.test(v))) hits.push(word);
  }
  return hits;
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

export function screenText(input: string, opts: ScreenOptions): ScreenResult {
  const text = normalise(input);
  const reasons = new Set<HoldReason>();
  const matches: string[] = [];

  const coords = findCoordinates(text);
  if (coords.length) {
    reasons.add("coordinates");
    matches.push(...coords);
  }

  const map = MAP_LINKS.find((re) => re.test(text));
  if (map) {
    reasons.add("map_link");
    matches.push(text.match(map)![0]);
  }

  const plus = text.match(PLUS_CODE);
  if (plus) {
    reasons.add("plus_code");
    matches.push(plus[0]);
  }

  for (const re of [EMAIL, TW_MOBILE, LINE_ID]) {
    const m = text.match(re);
    if (m) {
      reasons.add("contact");
      matches.push(m[0]);
    }
  }

  if (opts.newAccount) {
    const link = text.match(URL_LIKE);
    if (link) {
      reasons.add("link");
      matches.push(link[0]);
    }
  }

  const words = findWatchedWords(text, opts.watchedWords);
  if (words.length) {
    reasons.add("watched_word");
    matches.push(...words);
  }

  return { reasons: [...reasons], matches };
}

/**
 * Whether a new member's post waits for review simply because it is one of
 * their first two.
 *
 * Only when there are enough moderators to clear that queue every day. The
 * team's default (plan section 7, Q6): with fewer than three moderators able
 * to cover a daily rota, first-post review would leave new members waiting
 * days for their first words to appear, which teaches them the forum is dead;
 * so then only posts the filters catch are held. The moderator count is the
 * measurable half of that rule, and FORUM_REVIEW_FIRST_POSTS ("1" or "0")
 * lets the team state the other half outright.
 */
export const FIRST_POSTS_REVIEWED = 2;
export const MODERATORS_FOR_FIRST_POST_REVIEW = 3;

export function firstPostsNeedReview(opts: {
  /** The member's posts that are out: approved, or never held. */
  priorPosts: number;
  moderatorCount: number;
  override?: string;
}): boolean {
  if (opts.priorPosts >= FIRST_POSTS_REVIEWED) return false;
  if (opts.override === "1") return true;
  if (opts.override === "0") return false;
  return opts.moderatorCount >= MODERATORS_FOR_FIRST_POST_REVIEW;
}
