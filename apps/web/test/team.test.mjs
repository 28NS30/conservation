import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BASE_URL } from "./helpers.mjs";

/**
 * The team page, while there is no team on it.
 *
 * The page exists and the layout is reviewed so that adding real people is a
 * data change. What must not happen in the meantime is a placeholder person
 * reaching production: a fabricated name or face on a conservation project's
 * team page is exactly the thing a hostile reader would screenshot, and this
 * project's whole argument is that what it publishes is real.
 */
const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("the team page", () => {
  test("404s while the roster is empty", async () => {
    for (const path of ["/team", "/en/team"]) {
      const res = await fetch(`${BASE_URL}${path}`);
      assert.equal(res.status, 404, `${path} must not render an empty page`);
    }
  });

  test("nothing links to it while it is empty", async () => {
    const html = await (await fetch(`${BASE_URL}/en/about`)).text();
    assert.ok(
      !/href="[^"]*\/team"/.test(html),
      "the footer must not offer a link to a page that 404s",
    );
  });

  test("the roster carries no invented people", () => {
    // Asserted at source, deliberately. The page rendering nothing proves the
    // gate works, not that the file is empty — and this is the file where a
    // plausible-looking placeholder would be added "just to see the layout".
    const team = source("lib/team.ts");
    const roster = /export const TEAM: Person\[\] = \[([\s\S]*?)\];/.exec(team);
    assert.ok(roster, "TEAM must stay a plain array literal");
    assert.equal(
      roster[1].trim(),
      "",
      "no person may be added without the consent lib/team.ts describes",
    );
  });

  test("consent is stated where someone would add a person", () => {
    // The reason the array is empty has to be next to the array. A rule kept
    // only in a planning document is a rule the next person does not read.
    const team = source("lib/team.ts");
    assert.match(team, /個資法/);
    assert.match(team, /consent/i);
  });
});
