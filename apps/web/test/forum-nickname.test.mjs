/**
 * Forum names are generated, never typed and never taken from an account.
 *
 * Most members will be teenagers. A name someone types — their own, their
 * school's, a LINE id — is a way to find them, and Google sign-in hands the
 * account a full name and a photo. So the forum hands out "blue-magpie-4821"
 * and the server accepts nothing else: parseHandle() is the check the join
 * action applies to what the form sends, and it is the whole of the reason an
 * edited request cannot choose a name.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANIMALS,
  NUMBER_MAX,
  NUMBER_MIN,
  displayHandle,
  displayNickname,
  generateNickname,
  handleOf,
  parseHandle,
} from "../lib/forum/nickname.ts";

/** A deterministic stand-in for Math.random. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("generating", () => {
  test("every name is an animal on the list and four digits", () => {
    const rng = seeded(42);
    for (let i = 0; i < 2000; i++) {
      const n = generateNickname(rng);
      assert.ok(ANIMALS.some((a) => a.key === n.key), n.key);
      assert.ok(n.no >= NUMBER_MIN && n.no <= NUMBER_MAX, String(n.no));
      assert.deepEqual(parseHandle(handleOf(n)), n, "a generated name must be one the server accepts");
    }
  });

  test("the ends of the random range stay in range", () => {
    assert.deepEqual(generateNickname(() => 0), { key: ANIMALS[0].key, no: NUMBER_MIN });
    const top = generateNickname(() => 0.9999999999);
    assert.equal(top.key, ANIMALS.at(-1).key);
    assert.equal(top.no, NUMBER_MAX);
  });

  test("they vary: asking for another gives another", () => {
    const rng = seeded(7);
    const seen = new Set(Array.from({ length: 200 }, () => handleOf(generateNickname(rng))));
    assert.ok(seen.size > 190, `only ${seen.size} distinct names in 200`);
  });

  test("the generator takes no input about the person", () => {
    // Its only parameter is the random source. If it ever grows one for an
    // email or a profile, this is the test that has to be rewritten on purpose.
    assert.equal(generateNickname.length, 0);
  });

  test("every key has the shape the database checks, and names in both languages", () => {
    const keys = new Set();
    for (const a of ANIMALS) {
      assert.match(a.key, /^[a-z]+(-[a-z]+)*$/, a.key);
      assert.ok(a.zh && a.en, a.key);
      assert.ok(!keys.has(a.key), `duplicate key ${a.key}`);
      keys.add(a.key);
    }
    assert.ok(ANIMALS.length >= 40, "the list should be long enough that names rarely collide");
  });

  test("Chinese names use 臺, the house style", () => {
    for (const a of ANIMALS) assert.ok(!a.zh.includes("台"), a.zh);
  });
});

describe("the server accepts only generated names", () => {
  const refused = [
    "",
    "john-smith-1234", // not an animal on the list
    "blue-magpie", // no number
    "blue-magpie-123", // three digits
    "blue-magpie-12345",
    "blue-magpie-0999", // below the range
    "Blue-Magpie-4821", // capitals
    "blue_magpie-4821",
    " blue-magpie-4821",
    "blue-magpie-4821 ",
    "neolava2@gmail.com",
    "臺灣藍鵲-4821",
    "blue-magpie-4821<script>",
    "a".repeat(100) + "-1234",
  ];
  for (const raw of refused) {
    test(`refuses ${JSON.stringify(raw)}`, () => assert.equal(parseHandle(raw), null));
  }
  test("refuses anything that is not a string", () => {
    for (const v of [null, undefined, 4821, {}, ["blue-magpie-4821"]]) assert.equal(parseHandle(v), null);
  });
  test("accepts a real one", () => {
    assert.deepEqual(parseHandle("blue-magpie-4821"), { key: "blue-magpie", no: 4821 });
  });
});

describe("showing a name", () => {
  test("one identity, read in each language", () => {
    assert.equal(displayNickname({ key: "blue-magpie", no: 4821 }, "zh-TW"), "臺灣藍鵲 4821");
    assert.equal(displayNickname({ key: "blue-magpie", no: 4821 }, "en"), "Taiwan Blue Magpie 4821");
  });

  test("a deleted member has no name", () => {
    assert.equal(displayHandle(null, "en"), null);
  });

  test("a name whose animal was later removed from the list still shows", () => {
    assert.equal(displayHandle("dodo-1234", "en"), "dodo 1234");
  });
});

describe("the join action uses the check", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "app", "[locale]", "(site)", "community", "actions.ts"), "utf8");
  const join_ = src.slice(src.indexOf("export async function joinForum"), src.indexOf("export async function acceptGuidelines"));

  test("the nickname goes through parseHandle before it is stored", () => {
    assert.match(join_, /parseHandle\(form\.get\("nickname"\)\)/);
    assert.ok(join_.indexOf("parseHandle(") < join_.indexOf("insert into forum_profiles"));
  });

  test("and nothing about the account is read for it", () => {
    for (const leak of ["user_metadata", "full_name", "email", "display_name", "avatar"])
      assert.ok(!join_.includes(leak), `the join action must not read ${leak}`);
  });
});
