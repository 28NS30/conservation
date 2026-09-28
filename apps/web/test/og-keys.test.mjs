/**
 * A share card must never print a message key.
 *
 * The home page's card read `home.headline` for months after that key was
 * deleted. next-intl answers a missing message with the key path itself rather
 * than throwing, so nothing failed: the build was green, the page looked right,
 * and every link anyone shared on LINE or Facebook arrived titled
 * "home.headline". The card is rendered by an image route nobody opens, which is
 * exactly why it needs a test rather than an eye.
 *
 * This reads each opengraph-image route, works out which catalogue namespace
 * each translator variable is bound to, and checks every literal key it asks for
 * exists in BOTH catalogues.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB = join(import.meta.dirname, "..");
const catalogues = Object.fromEntries(
  ["en", "zh-TW"].map((l) => [l, JSON.parse(readFileSync(join(WEB, "messages", `${l}.json`), "utf8"))]),
);

function* ogRoutes(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* ogRoutes(p);
    else if (/^opengraph-image.*\.tsx$/.test(name)) yield p;
  }
}

const has = (obj, dotted) =>
  dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj) !== undefined;

const routes = [...ogRoutes(join(WEB, "app"))];

describe("share cards read only keys that exist", () => {
  test("there are share-card routes to check", () => {
    assert.ok(routes.length >= 2, `found ${routes.length} opengraph-image routes`);
  });

  for (const file of routes) {
    const src = readFileSync(file, "utf8");
    const name = relative(WEB, file);

    test(name, () => {
      // A card that never calls the catalogues has no key to lose. The species
      // card is one: its labels are written inline. Nothing to check there —
      // but a card that DOES use getTranslations and that this cannot parse is
      // a failure, not a pass, so the shape check below still bites.
      if (!/getTranslations\(/.test(src)) return;

      // const t = await getTranslations({ locale, namespace: "home" });
      const bindings = [...src.matchAll(/const\s+(\w+)\s*=\s*await\s+getTranslations\(\s*\{[^}]*namespace:\s*"([\w.]+)"[^}]*\}\s*\)/g)]
        .map(([, v, ns]) => ({ v, ns }));
      assert.ok(bindings.length > 0, `${name}: no namespaced translator found — if the route changed shape, update this test`);

      let checked = 0;
      for (const { v, ns } of bindings) {
        for (const [, key] of src.matchAll(new RegExp(`\\b${v}\\(\\s*"([\\w.]+)"`, "g"))) {
          checked++;
          for (const [locale, cat] of Object.entries(catalogues))
            assert.ok(
              has(cat, `${ns}.${key}`),
              `${name} reads "${ns}.${key}", which ${locale}.json does not have — the card would print the key itself`,
            );
        }
      }
      assert.ok(checked > 0, `${name}: found translators but no literal keys to check`);
    });
  }
});
