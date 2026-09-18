import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { labEnabled } from "../lib/lab/gate.ts";
import { LAB_DIRECTIONS, LAB_ROUTES, isLabDirection } from "../lib/lab/directions.ts";
import { LAB_COPY } from "../lib/lab/copy.ts";

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
