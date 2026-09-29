/**
 * What the forum holds for review before anyone else can read it.
 *
 * lib/forum/screen.ts is the forum's half of the location promise: the map
 * blurs a protected animal's position to 10 or 50 km, and a post saying
 * "25.0330, 121.5654" would undo that to the metre. So a post that looks like
 * it carries a location waits for a moderator. These cases are the table the
 * screen is held to — each format people actually type a location in, and
 * each innocent sentence that must NOT be held, because a filter that holds
 * 樹幹 ("tree trunk") or a great tit on a wildlife site gets switched off.
 *
 * Each group was checked by putting its defect back — deleting the pattern,
 * the normalisation, the allowlist — and watching its cases fail.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  screenText,
  normalise,
  firstPostsNeedReview,
  LOCATION_REASONS,
} from "../lib/forum/screen.ts";

const WORDS = ["幹你娘", "靠北", "ㄍㄋㄋ", "去死", "fuck", "shit", "kill yourself", "tit", "幹"];
const screen = (text, { newAccount = false, words = WORDS } = {}) =>
  screenText(text, { watchedWords: words, newAccount }).reasons;

/** [text, the reason it must be held for] */
const HELD = [
  // Decimal degrees, every way round.
  ["saw a pangolin at 25.0330, 121.5654", "coordinates"],
  ["25.0330,121.5654", "coordinates"],
  ["25.0330 121.5654", "coordinates"],
  ["121.5654, 25.0330 (lng first)", "coordinates"],
  ["N25.0330 E121.5654", "coordinates"],
  ["25.0330N, 121.5654E", "coordinates"],
  ["lat 25.0330 long 121.5654", "coordinates"],
  ["latitude: 25.03, longitude: 121.56", "coordinates"],
  ["北緯25.03度 東經121.56度", "coordinates"],
  ["(25.0330, 121.5654)", "coordinates"],
  ["25.0330/121.5654", "coordinates"],
  ["23.5 120.5", "coordinates"], // one decimal is 11 km, finer than a 50 km blur
  // Kinmen and Matsu are inside the bounds too.
  ["金門 24.43, 118.32", "coordinates"],
  ["馬祖 26.16 119.95", "coordinates"],
  // Full-width, as a Chinese keyboard types it.
  ["２５．０３３０，１２１．５６５４", "coordinates"],
  ["２５．０３３０\u3000１２１．５６５４", "coordinates"],
  // Degrees, minutes, seconds.
  ["25°01'58\"N 121°33'54\"E", "coordinates"],
  ["25°01\u203258\u2033N 121°33\u203254\u2033E", "coordinates"],
  ["25°01\u201958\u201DN, 121°33\u201954\u201DE", "coordinates"],
  ["25度01分58秒 121度33分54秒", "coordinates"],
  ["25°01.967' 121°33.900'", "coordinates"],
  // TWD97, the grid Taiwan's agencies publish.
  ["TWD97 302000, 2770000", "coordinates"],
  ["2770000 302000", "coordinates"],
  // A zero-width space between the halves.
  ["25.0330,\u200B121.5654", "coordinates"],
  // Map links, whatever they point at.
  ["https://maps.app.goo.gl/AbC123", "map_link"],
  ["https://goo.gl/maps/xyz", "map_link"],
  ["google.com/maps/place/Yangmingshan", "map_link"],
  ["https://www.google.com.tw/maps/@25.03,121.56,15z", "map_link"],
  ["https://maps.google.com/?q=25.03,121.56", "map_link"],
  ["https://maps.apple.com/?ll=25.03,121.56", "map_link"],
  ["https://maps.apple/p/abc", "map_link"],
  ["https://www.openstreetmap.org/#map=17/25.03/121.56", "map_link"],
  ["osm.org/go/abc", "map_link"],
  ["https://waze.com/ul?ll=25.03,121.56", "map_link"],
  ["geo:25.03,121.56", "map_link"],
  ["///filled.count.soap", "map_link"],
  // Plus Codes, full and short.
  ["7QQ32GJQ+XV", "plus_code"],
  ["2GJQ+XV 陽明山", "plus_code"],
  ["２ＧＪＱ＋ＸＶ", "plus_code"],
  // Contact details.
  ["email me at kid@example.com", "contact"],
  ["打給我 0912-345-678", "contact"],
  ["0912345678", "contact"],
  ["+886 912 345 678", "contact"],
  ["LINE id: froggy", "contact"],
  ["加line聊", "contact"],
  ["加賴", "contact"],
  // Watched words.
  ["幹你娘", "watched_word"],
  ["幹.你.娘", "watched_word"],
  ["幹 你 娘", "watched_word"],
  ["幹\u200B你\u200B娘", "watched_word"],
  ["真的靠北", "watched_word"],
  ["ㄍ ㄋ ㄋ", "watched_word"],
  ["幹！", "watched_word"],
  ["what the fuck", "watched_word"],
  ["FUCK", "watched_word"],
  ["f.u.c.k", "watched_word"],
  ["f u c k", "watched_word"],
  ["fuuuuck", "watched_word"],
  ["ｆｕｃｋ", "watched_word"],
  ["just kill   yourself", "watched_word"],
  ["you tit", "watched_word"],
  // From the security audit of 29 September 2026: separators, words between,
  // long gaps, invisible characters, search links and short links that all
  // went straight through.
  ["25.0330-121.5654", "coordinates"],
  ["25.0330 - 121.5654", "coordinates"],
  ["25.0330\u2013121.5654", "coordinates"],
  ["25.0330 ~ 121.5654", "coordinates"],
  ["25.0330 + 121.5654", "coordinates"],
  ["25.0330_121.5654", "coordinates"],
  ["25.0330。121.5654", "coordinates"],
  ["25.0330 至 121.5654", "coordinates"],
  ["lat 25.0330 and lng 121.5654", "coordinates"],
  ["緯度 25.0330 與 經度 121.5654", "coordinates"],
  ["25.0330" + " ".repeat(25) + "121.5654", "coordinates"],
  ["25.0330" + "\n".repeat(25) + "121.5654", "coordinates"],
  ["25.0\u20663\u20660 121.5654", "coordinates"],
  ["25.0\u034f330 121.5654", "coordinates"],
  ["25.0\u061c330 121.5654", "coordinates"],
  ["25.0\u3164330 121.5654", "coordinates"],
  ["25.0\u{E0020}330 121.5654", "coordinates"],
  ["https://www.google.com/search?q=25.0330+121.5654", "coordinates"],
  ["https://www.google.com/search?q=25.0330%2C121.5654", "coordinates"],
  ["25.0330N-121.5654E", "coordinates"],
  ["２５。０３３０，１２１。５６５４", "coordinates"],
  ["here: https://bit.ly/3abcDEF", "map_link"],
  ["reurl.cc/abc12", "map_link"],
  ["lihi1.cc/xyz", "map_link"],
  ["tinyurl.com/y7abc", "map_link"],
  ["https://g.page/r/abc", "map_link"],
  ["goo.gl/abc", "map_link"],
];

/** Text that must go straight through. */
const CLEAR = [
  "今天在樹幹上看到一隻鍬形蟲。", // 樹幹: tree trunk
  "幹部會議在週六。", // 幹部: committee
  "沿著幹線道路要小心路殺。", // 幹線: arterial road
  "幹細胞研究", // 幹細胞: stem cells
  "步道靠北邊的那一側比較陰涼。", // 靠北邊: the north side
  "a great tit in the park",
  "the blue tit and the coal tit",
  "a titmouse at the feeder",
  "brown booby over the sea", // not a watched word here, but allowlisted anyway
  "a peacock and a cockatoo",
  "shiitake mushrooms on a log",
  "shitake mushrooms", // the common misspelling: "shit" is inside a word
  "a petition to protect the forest", // "tit" inside a word
  "the constitution",
  "Scunthorpe", // "cunt" is not in the list above, and boundaries protect it anyway
  "體長 23.5 公分，重 120.5 克", // two measurements
  "measured 23.5 and 120.5",
  "35.68, 139.69 is Tokyo", // a pair outside Taiwan
  "今天25度，明天28度", // temperatures
  "氣溫 25°C",
  "v1.2.3 released",
  "on 2023.10.15 at 10.30",
  "timeline: next week",
  "陽明山國家公園", // a place name cannot be caught; see the guidelines and flags
  "https://example.com/a-link", // links are fine from an established account
  "see roadkill.tw for more",
];

describe("held for review", () => {
  for (const [text, reason] of HELD) {
    test(`${JSON.stringify(text)} → ${reason}`, () => {
      assert.ok(screen(text).includes(reason), `expected ${reason}, got [${screen(text)}]`);
    });
  }
});

describe("let through", () => {
  for (const text of CLEAR) {
    test(JSON.stringify(text), () => {
      assert.deepEqual(screen(text), []);
    });
  }
});

describe("links from new accounts", () => {
  test("any link at all is held while the account is younger than seven days", () => {
    for (const text of ["https://example.com", "www.example.com", "see roadkill.tw", "gbif.org/species/1"]) {
      assert.ok(screen(text, { newAccount: true }).includes("link"), text);
      assert.ok(!screen(text, { newAccount: false }).includes("link"), text);
    }
  });

  test("an email address is contact details, not a link", () => {
    assert.deepEqual(screen("a@b.com", { newAccount: true }), ["contact"]);
  });
});

describe("the watched-word rules", () => {
  test("a single Chinese character counts only when it stands alone", () => {
    assert.deepEqual(screen("樹幹", { words: ["幹"] }), []);
    assert.deepEqual(screen("幹!", { words: ["幹"] }), ["watched_word"]);
  });

  test("the list comes from the caller, so a removed word stops matching", () => {
    assert.deepEqual(screen("真的靠北", { words: [] }), []);
  });

  test("a word stored with capitals or full-width letters still matches", () => {
    assert.deepEqual(screen("oh shit", { words: ["ＳＨＩＴ"] }), ["watched_word"]);
  });
});

describe("normalising", () => {
  test("full-width digits and punctuation become ASCII", () => {
    assert.equal(normalise("２５．０３，１２１"), "25.03,121");
  });

  test("primes and curly quotes become ' and \"", () => {
    assert.equal(normalise("25°01\u203258\u2033"), "25°01'58\"");
    assert.equal(normalise("25°01\u201958\u201D"), "25°01'58\"");
  });

  test("zero-width characters are removed", () => {
    assert.equal(normalise("f\u200Bu\u200Dck"), "fuck");
  });
});

describe("what the poster is told", () => {
  test("coordinates, map links and Plus Codes are the location reasons", () => {
    assert.deepEqual([...LOCATION_REASONS].sort(), ["coordinates", "map_link", "plus_code"]);
  });

  test("the screen reports what matched, for the moderator", () => {
    const { matches } = screenText("at 25.0330, 121.5654", { watchedWords: [], newAccount: false });
    assert.deepEqual(matches, ["25.0330, 121.5654"]);
  });
});

describe("a new member's first posts", () => {
  test("held only when there are three or more moderators to clear them", () => {
    assert.equal(firstPostsNeedReview({ priorPosts: 0, moderatorCount: 2 }), false);
    assert.equal(firstPostsNeedReview({ priorPosts: 0, moderatorCount: 3 }), true);
    assert.equal(firstPostsNeedReview({ priorPosts: 1, moderatorCount: 3 }), true);
  });

  test("never after the first two", () => {
    assert.equal(firstPostsNeedReview({ priorPosts: 2, moderatorCount: 10 }), false);
    assert.equal(firstPostsNeedReview({ priorPosts: 2, moderatorCount: 10, override: "1" }), false);
  });

  test("the team can say so outright", () => {
    assert.equal(firstPostsNeedReview({ priorPosts: 0, moderatorCount: 0, override: "1" }), true);
    assert.equal(firstPostsNeedReview({ priorPosts: 0, moderatorCount: 9, override: "0" }), false);
  });
});
