import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { labEnabled } from "../lib/lab/gate.ts";
import { LAB_DIRECTIONS, LAB_ROUTES, isLabDirection } from "../lib/lab/directions.ts";
import { LAB_COPY } from "../lib/lab/copy.ts";
import {
  findingSentence,
  hanziCount,
  isWithheld,
  lineageRows,
  nameSizes,
  peakMonth,
  speciesLegendItems,
} from "../lib/lab/species.ts";
import { SPECIES_DENSITY_CLASSES } from "@conservation/shared";
import {
  LAB_FONT_PRELOAD,
  inLabCharset,
  labFaceClass,
} from "../lib/lab/fonts.ts";

/**
 * The design lab's four load-bearing promises.
 *
 * Everything under `app/[locale]/lab`, `components/lab` and `lib/lab` is
 * throwaway code that will be deleted once a direction wins, so it does not
 * deserve much testing. These four things do, because each of them fails
 * silently and each of them would be found by somebody other than us:
 *
 *   1. the gate, which is all that keeps a prototype off production;
 *   2. the direction keys, which are the only two values a route may take;
 *   3. copy parity, because a missing key renders an English sentence inside a
 *      Chinese page rather than throwing;
 *   4. the ramps, because a colour nudged to taste breaks the one thing that
 *      makes six density classes readable at once, and nothing on screen says so.
 *
 * Plus one structural guard: no lab component may name a colour. That is the
 * whole bet — a direction is a CSS file, not a rebuild — and it is the kind of
 * rule that decays one hex at a time.
 */

const WEB = new URL("..", import.meta.url).pathname;
const THEMES = join(WEB, "app/[locale]/lab/themes");

describe("lab gate", () => {
  test("production is closed unless it is explicitly opened", () => {
    assert.equal(labEnabled({ VERCEL_ENV: "production" }), false);
    assert.equal(
      labEnabled({ VERCEL_ENV: "production", LAB_ENABLED: "1" }),
      true,
    );
  });

  test("only the exact string 1 opens it", () => {
    // A truthy-looking value is the way a flag gets left on by accident.
    for (const value of ["", "0", "true", "yes", "on"])
      assert.equal(
        labEnabled({ VERCEL_ENV: "production", LAB_ENABLED: value }),
        false,
        `LAB_ENABLED=${JSON.stringify(value)} should not open production`,
      );
  });

  test("everywhere that is not production is open", () => {
    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }])
      assert.equal(labEnabled(env), true);
  });
});

describe("lab directions", () => {
  test("there are exactly two, and they are these two", () => {
    assert.deepEqual([...LAB_DIRECTIONS], ["roundel", "journal"]);
  });

  test("nothing else is a direction", () => {
    for (const value of ["", "Roundel", "roundel/", "map", "../map", "themes"])
      assert.equal(isLabDirection(value), false, `${value} must not route`);
    for (const value of LAB_DIRECTIONS) assert.equal(isLabDirection(value), true);
  });

  test("the route segment refuses params it did not generate", () => {
    // `dynamicParams = false` is what turns /lab/anything-else into a 404
    // rather than a page rendered with no theme at all — which does not crash,
    // it just looks like unstyled HTML.
    const layout = readFileSync(
      join(WEB, "app/[locale]/lab/[direction]/layout.tsx"),
      "utf8",
    );
    assert.match(layout, /export const dynamicParams = false/);
    assert.match(layout, /LAB_DIRECTIONS\.map/);
  });

  test("every route belongs to at least one direction, and to no other", () => {
    for (const route of LAB_ROUTES) {
      assert.ok(route.directions.length > 0, `${route.sub} goes nowhere`);
      for (const direction of route.directions)
        assert.ok(isLabDirection(direction), `${route.sub}: ${direction}`);
      assert.ok(route.live.startsWith("/"), `${route.sub} has no live twin`);
    }
  });
});

describe("lab copy", () => {
  const locales = Object.keys(LAB_COPY);

  const walk = (value, prefix = "") =>
    typeof value === "string"
      ? [prefix]
      : Object.entries(value).flatMap(([key, child]) =>
          walk(child, prefix ? `${prefix}.${key}` : key),
        );

  test("both locales carry exactly the same keys", () => {
    assert.deepEqual(locales, ["zh-TW", "en"]);
    const [first, ...rest] = locales.map((l) => walk(LAB_COPY[l]).sort());
    for (const keys of rest) assert.deepEqual(keys, first);
    assert.ok(first.length > 100, "copy looks truncated");
  });

  test("no string is empty", () => {
    for (const locale of locales)
      for (const key of walk(LAB_COPY[locale])) {
        const value = key
          .split(".")
          .reduce((node, part) => node[part], LAB_COPY[locale]);
        assert.ok(value.trim().length > 0, `${locale}.${key} is blank`);
      }
  });

  test("a placeholder in one language exists in the other", () => {
    // 還差：{what} translated without its {what} is a sentence that renders as
    // an unfinished thought, and nothing throws.
    const holders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of walk(LAB_COPY["zh-TW"])) {
      const read = (locale) =>
        key.split(".").reduce((node, part) => node[part], LAB_COPY[locale]);
      assert.deepEqual(
        holders(read("en")),
        holders(read("zh-TW")),
        `placeholders differ in ${key}`,
      );
    }
  });
});

/** WCAG 2.x relative luminance and contrast, on sRGB hex. */
function luminance(hex) {
  const channel = (c) => {
    const v = parseInt(hex.slice(c, c + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

describe("lab density ramps", () => {
  for (const direction of LAB_DIRECTIONS) {
    const css = readFileSync(join(THEMES, `${direction}.css`), "utf8");
    const read = (name) => {
      const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`).exec(css);
      assert.ok(match, `${direction}.css defines no --${name}`);
      return match[1];
    };

    test(`${direction} scopes its tokens to its own directive`, () => {
      assert.match(css, new RegExp(`\\[data-direction="${direction}"\\]`));
      // Anything outside a [data-direction] block would reach live pages,
      // which is the one thing this whole directory promises not to do.
      assert.doesNotMatch(css, /^\s*(:root|html|body)\s*\{/m);
    });

    test(`${direction} step 1 clears 3:1 against its own land`, () => {
      const land = read("map-land");
      const step1 = contrast(read("ramp-1"), land);
      assert.ok(
        step1 >= 3,
        `${direction} ramp-1 is ${step1.toFixed(2)}:1 on land, under 3`,
      );
    });

    test(`${direction} steps stay apart and keep their order`, () => {
      const steps = [1, 2, 3, 4, 5, 6].map((n) => read(`ramp-${n}`));
      const lums = steps.map(luminance);
      const rising = lums.every((l, i) => i === 0 || l > lums[i - 1]);
      const falling = lums.every((l, i) => i === 0 || l < lums[i - 1]);
      assert.ok(
        rising || falling,
        `${direction}'s ramp is not lightness-monotonic: two classes swap places`,
      );
      for (let i = 1; i < steps.length; i += 1) {
        const step = contrast(steps[i], steps[i - 1]);
        assert.ok(
          step >= 1.25,
          `${direction} ramp ${i} to ${i + 1} is ${step.toFixed(2)}, under 1.25`,
        );
      }
    });
  }
});

describe("lab components name no colours", () => {
  function* sources(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) yield* sources(path);
      else if (/\.tsx?$/.test(name)) yield path;
    }
  }

  test("a direction is a CSS file, so no hex and no raw palette name escapes it", () => {
    const offenders = [];
    for (const dir of ["components/lab", "lib/lab", "app/[locale]/lab"])
      for (const file of sources(join(WEB, dir))) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b|--lab-[a-z0-9-]+/g))
          offenders.push(`${file.slice(WEB.length)}: ${match[0]}`);
      }
    assert.deepEqual(
      [...new Set(offenders)],
      [],
      "these name a direction's own palette; read the semantic layer instead",
    );
  });
});

/**
 * The display faces.
 *
 * Every one of these fails silently. A face whose `unicode-range` claims a
 * character its file does not hold is a blank rectangle; one that omits a
 * character the file does hold is a file nobody ever fetches; a catalogue
 * string outside both faces is a heading that comes out in two typefaces on an
 * iPhone and in one on the machine it was built on. None of it throws, and
 * none of it is visible in a diff — the woff2 files are binary and the ranges
 * are four thousand characters of hex.
 *
 * Between them these and `e2e/lab/fonts.mjs` cover the contract: this file
 * checks that what was cut matches what is declared, and that one checks what a
 * real browser actually fetches per route.
 */
const FONTS = join(WEB, "public/lab/fonts");
const charset = JSON.parse(readFileSync(join(FONTS, "charset.json"), "utf8"));

/** `U+4e00-4e03, U+4e07` back into sorted [first, last] pairs. */
const parseRange = (range) =>
  range.split(",").map((part) => {
    const [first, last] = part.trim().replace(/^U\+/i, "").split("-");
    const start = parseInt(first, 16);
    return [start, last === undefined ? start : parseInt(last, 16)];
  });

const pointsIn = (range) => {
  const points = [];
  for (const [start, end] of parseRange(range))
    for (let point = start; point <= end; point += 1) points.push(point);
  return points;
};

describe("lab display faces", () => {
  const allFaces = Object.values(charset.families).flatMap((f) => f.faces);

  test("every face charset.json names is on disk at the size it records", () => {
    // The outputs are committed rather than built on Vercel, so the file and
    // the manifest can only agree if someone re-ran the subsetter after the
    // last edit to the copy.
    for (const face of allFaces) {
      const size = statSync(join(FONTS, face.file)).size;
      assert.equal(size, face.bytes, `${face.file} is ${size}, not ${face.bytes}`);
    }
  });

  test("the preloaded face fits the budget the owner's phone has", () => {
    // direction.md's prototype test: 60 KB for Roundel, 190 KB for the journal
    // (a Ming face carries more outline per glyph). This is the one font
    // request the home page makes, on a phone, outdoors, on mobile data.
    const budgets = { roundel: 60 * 1024, journal: 190 * 1024 };
    for (const [direction, budget] of Object.entries(budgets)) {
      const file = LAB_FONT_PRELOAD[direction].split("/").pop();
      const face = allFaces.find((f) => f.file === file);
      assert.ok(face, `no face for ${direction}`);
      assert.ok(
        face.bytes <= budget,
        `${direction} preloads ${(face.bytes / 1024).toFixed(1)} KB, over ${budget / 1024} KB`,
      );
    }
  });

  test("the three faces of a family never claim the same character", () => {
    // Two faces claiming one code point is a coin toss decided by declaration
    // order, which is a thing nobody debugging a wrong glyph would think to
    // look at.
    for (const [prefix, family] of Object.entries(charset.families)) {
      const seen = new Map();
      for (const face of family.faces)
        for (const point of pointsIn(face.unicodeRange)) {
          const other = seen.get(point);
          assert.equal(
            other,
            undefined,
            `${prefix}: U+${point.toString(16)} is in both ${other} and ${face.id}`,
          );
          seen.set(point, face.id);
        }
      assert.deepEqual(
        [...seen.keys()].sort((a, b) => a - b),
        pointsIn(charset.covered),
        `${prefix}: its faces and the published charset disagree`,
      );
    }
  });

  test("every catalogue character is in a face", () => {
    // direction.md §2.2: "A test fails if a catalogue Hanzi is outside home ∪
    // ui." The symptom otherwise is a heading that mixes typefaces — and only
    // for the one string nobody happened to look at.
    const catalogues = ["messages/zh-TW.json", "messages/en.json"].map((p) =>
      readFileSync(join(WEB, p), "utf8"),
    );
    const missing = new Set();
    for (const text of [...catalogues, JSON.stringify(LAB_COPY)])
      for (const character of text)
        if (character.codePointAt(0) > 0x7e && !inLabCharset(character))
          missing.add(character);
    assert.deepEqual(
      [...missing],
      [],
      "re-run `npm run lab:fonts` — these are set in the system face",
    );
  });

  test("faces.css declares what charset.json says it cut", () => {
    const css = readFileSync(join(THEMES, "faces.css"), "utf8");
    for (const [prefix, family] of Object.entries(charset.families))
      for (const face of family.faces) {
        assert.ok(
          css.includes(`url("/lab/fonts/${face.file}")`),
          `faces.css never names ${face.file}`,
        );
        assert.ok(
          css.includes(`unicode-range: ${face.unicodeRange};`),
          `${prefix} ${face.id}: the declared range is not the one it was cut to`,
        );
      }
    // swap, not optional or block: outdoors on a slow connection the owner
    // should read the page in the system face and watch it change, not sit in
    // front of invisible text or a page that silently never applied its font.
    const swaps = css.match(/font-display: swap;/g) ?? [];
    assert.equal(swaps.length, allFaces.length);
  });

  test("the journal's fallback stack is the one journal.css names", () => {
    // fonts.css spells the serif stack out a second time because a custom
    // property cannot be defined in terms of itself. This is the pin that keeps
    // the copy honest: drift shows up as a title in the wrong serif, only on a
    // machine that has none of the named fonts installed.
    const journalBlock = (file, selector) => {
      const css = readFileSync(join(THEMES, file), "utf8");
      const at = css.indexOf(selector);
      assert.ok(at >= 0, `${file} has no ${selector} block`);
      return css.slice(at, css.indexOf("}", at));
    };
    const stack = (block, name) =>
      new RegExp(`--${name}:([^;]+);`).exec(block)[1].replace(/\s+/g, " ").trim();
    assert.equal(
      stack(
        journalBlock("fonts.css", 'html [data-direction="journal"]'),
        "font-display-fallback",
      ),
      stack(
        journalBlock("journal.css", '[data-direction="journal"]'),
        "font-display",
      ),
    );
  });

  test("a name the subsets cannot draw is set wholly in the system face", () => {
    // The species the lab's own routes name are in the subset; the rest of
    // Taiwan's checklist is not, and direction.md §2.2 says such a title goes
    // to the system face entirely rather than mixing per glyph.
    for (const name of ["黑眶蟾蜍", "斯文豪氏頸槽蛇", "臺灣穿山甲"])
      assert.equal(labFaceClass(name), "", `${name} should be in the subset`);
    assert.equal(labFaceClass("貓"), "face-system");
    // One character out of six is enough: it is all or nothing, per title.
    assert.equal(labFaceClass("黑眶蟾蜍貓"), "face-system");
    // Latin, digits and the space between words never drop a title.
    assert.equal(labFaceClass("FormosaWatch 2011–2017"), "");
  });
});

/**
 * The species page's own three silent failures.
 *
 * Same bar as the four above: each of these is wrong in a way nobody sees.
 *
 *   1. The name's size is decided by counting HAN CHARACTERS. Count code units
 *      or code points instead and 中國石龍子臺灣亞種 takes the 56px step on a
 *      phone, which is 504px of name in a 358px column.
 *   2. The finding sentence must not exist when there is nothing to find. A
 *      template rendered with an empty count reads "年間有 筆紀錄" and throws
 *      nothing at all.
 *   3. 座標不開放 is not "no records". Those taxa have no rows in
 *      `reports_public`, so their count is 0, and the one sentence this page
 *      must never print is "no reports yet" over a species that has plenty.
 */
describe("lab species page", () => {
  const copy = LAB_COPY["zh-TW"];

  test("the name's step is counted in Hanzi, not in characters", () => {
    assert.equal(hanziCount("黑眶蟾蜍"), 4);
    assert.equal(hanziCount("中國石龍子臺灣亞種"), 9);
    // A Latin binomial has none, and a mixed name counts only its Hanzi.
    assert.equal(hanziCount("Duttaphrynus melanostictus"), 0);
    assert.equal(hanziCount("臺灣 穿山甲"), 5);
  });

  test("six Hanzi or fewer takes the top step, and Latin never does", () => {
    assert.deepEqual(nameSizes("黑眶蟾蜍"), {
      desktop: "hero",
      phone: "display",
    });
    assert.deepEqual(nameSizes("斯文豪氏頸槽蛇"), {
      desktop: "display",
      phone: "title",
    });
    assert.deepEqual(nameSizes("中國石龍子臺灣亞種"), {
      desktop: "display",
      phone: "title",
    });
    // 80px of "Plestiodon chinensis formosensis" is three lines of a foreign
    // word; the hero step is for a name you take in at a glance.
    assert.deepEqual(nameSizes("Plestiodon chinensis formosensis"), {
      desktop: "display",
      phone: "title",
    });
  });

  test("only TaiCOL's own rating withholds coordinates", () => {
    assert.equal(isWithheld("座標不開放"), true);
    // The other three sensitivity grades blur a location; they do not hide it,
    // and treating them as withheld would drop the map from 1,273 pages.
    for (const grade of ["輕度", "重度", "縣市", null, ""])
      assert.equal(isWithheld(grade), false, `${grade} is not withheld`);
  });

  test("the peak month is the month, or nothing", () => {
    assert.equal(peakMonth(Array(12).fill(0)), null);
    assert.equal(peakMonth([62, 86, 148, 729, 414, 288, 650, 389, 268, 349, 534, 61]), 3);
    // First of a tie, so the sentence and the drawn bar always agree.
    assert.equal(peakMonth([5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 0);
  });

  test("the finding sentence says the real numbers, or does not exist", () => {
    const toad = {
      reportCount: 3978,
      firstSeen: "2011-08-31T00:00:00.000Z",
      lastSeen: "2017-12-20T00:00:00.000Z",
    };
    const counts = [62, 86, 148, 729, 414, 288, 650, 389, 268, 349, 534, 61];
    // Verbatim from direction.md §4, down to the punctuation.
    assert.equal(
      findingSentence(copy, "zh-TW", toad, counts),
      "2011–2017 年間有 3,978 筆紀錄，四月最多。",
    );
    assert.equal(
      findingSentence(LAB_COPY.en, "en", toad, counts),
      "3,978 records between 2011 and 2017, most of them in April.",
    );
    // Nothing to find: no sentence at all, not a sentence about absence.
    assert.equal(
      findingSentence(copy, "zh-TW", { ...toad, reportCount: 0 }, Array(12).fill(0)),
      null,
    );
    assert.equal(
      findingSentence(copy, "zh-TW", { ...toad, firstSeen: null }, counts),
      null,
    );
    // No placeholder survives into anything the reader sees.
    assert.doesNotMatch(
      String(findingSentence(copy, "zh-TW", toad, counts)),
      /[{}]/,
    );
  });

  test("the legend is generated from the classes the map paints", () => {
    const items = speciesLegendItems();
    assert.equal(items.length, SPECIES_DENSITY_CLASSES.length);
    assert.deepEqual(
      items.map((i) => i.label),
      ["1", "2–4", "5–14", "15–39", "40+"],
    );
    // Starts a step up the ramp: on ONE species a single record is the signal,
    // not the background, so the dimmest class is not used at all.
    assert.deepEqual(
      items.map((i) => i.ramp),
      [2, 3, 4, 5, 6],
    );
  });

  test("the lineage stops at genus and italicises only that", () => {
    const rows = lineageRows(copy, {
      kingdom: "Animalia",
      phylum: "Chordata",
      class: "Amphibia",
      order: "Anura",
      family: "Bufonidae",
      genus: "Duttaphrynus",
    });
    assert.deepEqual(
      rows.map((r) => r.name),
      ["Animalia", "Chordata", "Amphibia", "Anura", "Bufonidae", "Duttaphrynus"],
    );
    assert.deepEqual(
      rows.map((r) => r.italic),
      [false, false, false, false, false, true],
    );
    // Ranks TaiCOL does not record collapse rather than printing a blank row.
    assert.equal(
      lineageRows(copy, {
        kingdom: "Animalia",
        phylum: null,
        class: null,
        order: null,
        family: null,
        genus: null,
      }).length,
      1,
    );
  });
});
