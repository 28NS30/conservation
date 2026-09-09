/**
 * `confirmSpecies` is the only path by which a member of the public writes a
 * taxon onto a record.
 *
 * That write does three things at once: it names the species, it stamps
 * `taxon_source` (which the Darwin Core export turns into a verification
 * status seen by everyone downstream), and it clears `precision_override`,
 * handing location precision back to whatever the newly-named taxon's own
 * policy says. Name a non-sensitive taxon and the record publishes at exact
 * coordinates.
 *
 * A server action is a public POST endpoint, so the five suggestions rendered by
 * SpeciesConfirm constrain the UI and nothing else. These pin the server-side
 * half: a reporter may only pick a species the classifier actually proposed for
 * that report, and a moderator may pick anything.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback, insertReport } from "./helpers.mjs";

after(() => sql.end());

const ACTIONS = join(
  import.meta.dirname,
  "..",
  "app",
  "[locale]",
  "(site)",
  "reports",
  "[id]",
  "actions.ts",
);
const src = readFileSync(ACTIONS, "utf8");

const EXPORT = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "scripts", "export-dwca.ts"),
  "utf8",
);

describe("confirm species", () => {
  test("a reporter's choice is constrained to the report's own candidates", () => {
    assert.match(
      src,
      /from classifications\s+where report_id = \$\{reportId\}::uuid\s+and taxon_id\s+= \$\{taxonId\}/,
      "the chosen taxon must be checked against this report's classifications",
    );
    const guard = src.indexOf("from classifications");
    const write = src.indexOf("update reports");
    assert.ok(
      guard > 0 && guard < write,
      "the check has to run before the write",
    );
  });

  test("the constraint applies to reporters and not to moderators", () => {
    // An expert correction exists precisely because the classifier's guesses
    // were wrong, so it must not be limited to them.
    assert.match(
      src,
      /if \(!moderator\) \{[\s\S]*?from classifications/,
      "the candidate check must be inside a !moderator branch",
    );
  });

  test("the path is rate limited", () => {
    assert.match(src, /withinRateLimit\(`retaxon:user:\$\{userId\}`/);
  });

  test("a self-identification is not exported as verified", () => {
    // "Verified by" is a claim about a second party. On the `user` path there
    // is no second party — one person agreeing with a machine about their own
    // photograph.
    const map = EXPORT.slice(
      EXPORT.indexOf("const VERIFICATION"),
      EXPORT.indexOf("const VERIFICATION") + 400,
    );
    assert.ok(
      !/user:\s*"Verified/.test(map),
      "taxon_source='user' must not be exported as verified",
    );
    assert.match(map, /expert:\s*"Verified by moderator"/);
  });

  test("only the classifier's candidates exist to be picked", async () => {
    // The property the guard depends on: classifications are per-report, so a
    // membership check is a real restriction rather than a formality.
    await inRollback(async (tx) => {
      const r = await insertReport(tx, {
        category: "invasive",
        status: "pending",
      });
      const [{ n }] = await tx`
        select count(*)::int as n from classifications where report_id = ${r.id}::uuid`;
      assert.equal(
        n,
        0,
        "a fresh report proposes nothing, so nothing is pickable",
      );
    });
  });
});
