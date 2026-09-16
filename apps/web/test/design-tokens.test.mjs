import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every colour class drawn from our own palette must name a token that exists.
 *
 * Tailwind v4 emits nothing for a class whose `--color-*` variable is missing —
 * no warning, no build error. `text-ink-400` was used in eight places across
 * five files, including the species picker and the species card, and rendered
 * as whatever colour it inherited, because the ink scale deliberately stops at
 * 500: that is the lightest step that clears WCAG AA on paper.
 */
const WEB = new URL("..", import.meta.url).pathname;
const css = readFileSync(join(WEB, "app/globals.css"), "utf8");
const defined = new Set(
  [...css.matchAll(/--color-([a-z]+-\d+)\s*:/g)].map((m) => m[1]),
);
const FAMILIES = ["paper", "ink", "ember", "moss", "bark", "parchment"];

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(tsx?|jsx?)$/.test(name)) yield p;
  }
}

describe("design tokens", () => {
  test("the palette families are defined at all", () => {
    for (const f of FAMILIES)
      assert.ok(
        [...defined].some((d) => d.startsWith(`${f}-`)),
        `no --color-${f}-* tokens found; has globals.css moved?`,
      );
  });

  test("no class names a step the palette does not have", () => {
    const pattern = new RegExp(
      `\\b[a-z-]*?-(${FAMILIES.join("|")})-(\\d+)\\b`,
      "g",
    );
    const missing = [];
    for (const dir of ["app", "components"])
      for (const file of sources(join(WEB, dir))) {
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(pattern)) {
          const token = `${m[1]}-${m[2]}`;
          if (!defined.has(token))
            missing.push(`${file.slice(WEB.length)}: ${m[0]}`);
        }
      }
    assert.deepEqual(
      [...new Set(missing)],
      [],
      "these classes produce no CSS — use a defined step",
    );
  });
});
