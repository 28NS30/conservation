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
import { sql, inRollback, insertReport, taxonWhere } from "./helpers.mjs";

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

// The export's per-record mapping, which moved out of export-dwca.ts so it
// could be tested; VERIFICATION lives there now.
const EXPORT = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "scripts", "dwc-occurrences.ts"),
  "utf8",
);

const ADMIN = readFileSync(
  join(import.meta.dirname, "..", "app", "[locale]", "(site)", "admin", "actions.ts"),
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

describe("naming the species leaves the category as it was filed", () => {
  test("neither path that sets a taxon rewrites the category", () => {
    // They used to (`recategorise`), so that a `sighting` confirmed to be an
    // invasive species would show under the invasive filter. The classifier
    // and a TaiCOL refresh never did, so the stored category drifted from the
    // species. Invasiveness is read from the species now (0016), and naming
    // it is enough; test/report-category.test.mjs walks what that does to a
    // record's collections.
    for (const [name, source] of [["confirmSpecies", src], ["setReportTaxon", ADMIN]]) {
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      assert.doesNotMatch(code, /recategorise/, `${name} re-derives the category`);
      assert.doesNotMatch(code, /\bcategory\s*=\s*\$\{/, `${name} writes the category`);
    }
  });
});

describe("every path that names a species applies one override rule", () => {
  test("all three use the shared fragment, and none writes its own", () => {
    // They disagreed: two cleared `precision_override` unconditionally and one
    // never touched it, so the same correction had two different consequences
    // for a location depending on which screen it was made from.
    const CLASSIFY = readFileSync(
      join(import.meta.dirname, "..", "app", "api", "jobs", "classify", "route.ts"),
      "utf8",
    );
    // The classifier uses photoIdentificationOverride, which is this rule plus
    // the blur a photograph needs (test/classify-policy.test.mjs pins that it
    // is built on keepDeliberateOverride and not beside it).
    for (const [name, source] of [
      ["confirmSpecies", src],
      ["setReportTaxon", ADMIN],
      ["the classifier", CLASSIFY],
    ]) {
      // One of the two shared fragments, or a choice between them.
      const shared = String.raw`(?:keepDeliberateOverride\(\)|photoIdentificationOverride\([^)]*\))`;
      assert.match(
        source,
        new RegExp(
          String.raw`precision_override = \$\{\s*(?:[^?}]*\?\s*${shared}\s*:\s*)?${shared}\s*\}`,
        ),
        `${name} does not use the shared rule`,
      );
      assert.doesNotMatch(
        source,
        /precision_override = null/,
        `${name} still clears the override unconditionally`,
      );
    }
  });
});

describe("a species named from the model's suggestions", () => {
  // The classifier blurs a species it names itself at least as hard as the
  // strictest row sharing the binomial, because a photograph cannot tell those
  // rows apart and the label list holds deleted rows and duplicates. Invasive
  // answers and medium-band answers are only ever suggestions, so most
  // species named from a photograph are named here instead, by a tap on one
  // of those same suggestions — and here the rule was missing.
  let seq = 0;
  const name = () => `Testudofixtura c${process.pid}x${Date.now()}x${seq++}`;
  async function row(tx, scientificName, { status = "accepted", protectedStatus = null } = {}) {
    const [t] = await tx`
      insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan,
                        taxon_status, protected_status)
      values (${`test-cs-${process.pid}-${Date.now()}-${seq++}`}, ${scientificName},
              'Species', true, ${status}, ${protectedStatus})
      returning id`;
    return t.id;
  }

  test("both confirm paths name a species through the photograph rule", () => {
    assert.match(src, /precision_override = \$\{photoIdentificationOverride\(taxonId\)\}/);
    assert.match(
      ADMIN,
      /taxonId === null\s*\?\s*keepDeliberateOverride\(\)\s*:\s*photoIdentificationOverride\(taxonId\)/,
    );
  });

  test("the unrated twin of a protected row is not published exactly", async () => {
    await inRollback(async (tx) => {
      const binomial = name();
      const open = await row(tx, binomial);
      await row(tx, binomial, { status: "deleted", protectedStatus: "II" });

      // As the classifier leaves a medium-band report: unidentified, stamped,
      // with its candidates stored.
      const r = await insertReport(tx, { taxonId: null, override: "coarse_10km" });
      await tx`insert into classifications (report_id, taxon_id, score, rank, model_version)
               values (${r.id}::uuid, ${open}, 0.5, 1, 'test')`;

      // The action's own statement, reduced to the columns under test. With
      // keepDeliberateOverride() alone this publishes exact.
      const [row_] = await tx`
        update reports
           set taxon_id = ${open},
               taxon_source = 'user',
               precision_override = stricter_precision(
                 case when taxon_id is null then null else precision_override end,
                 binomial_precision_floor(${open}))
         where id = ${r.id}::uuid
        returning precision_override, location_precision`;
      assert.equal(row_.location_precision, "coarse_10km",
        "a tapped suggestion was published looser than its protected twin");
    });
  });
});

describe("what clearing precision_override is allowed to undo", () => {
  test("the unidentified stamp is cleared, because naming it is the answer", async () => {
    await inRollback(async (tx) => {
      const r = await insertReport(tx, {
        taxonId: null,
        category: "sighting",
        override: "coarse_10km",
      });
      const taxonId = await taxonWhere(
        "sensitivity is null and protected_status is null and is_in_taiwan",
      );
      // The action's own statement, reduced to the columns under test.
      await tx`update reports
                  set taxon_id = ${taxonId},
                      precision_override = case
                        when taxon_id is null then null
                        else precision_override
                      end
                where id = ${r.id}`;
      const [row] = await tx`select precision_override, location_precision
                               from reports where id = ${r.id}`;
      assert.equal(row.precision_override, null, "the stamp was what it was waiting for");
      assert.equal(row.location_precision, "exact", "precision is the taxon's own again");
    });
  });

  test("an override on a record that already had a taxon survives", async () => {
    // This is the case the GBIF name remap writes: 371 records held coarser
    // than their taxon's rating asks, because the name they used to carry
    // justified a blur the corrected name would not. Clearing it would
    // publish a location somebody decided to withhold.
    await inRollback(async (tx) => {
      const before = await taxonWhere(
        "sensitivity is null and protected_status is null and is_in_taiwan",
      );
      const r = await insertReport(tx, {
        taxonId: before,
        category: "sighting",
        override: "coarse_10km",
      });
      assert.equal(r.location_precision, "coarse_10km", "the fixture starts blurred");

      const after = await taxonWhere(
        "sensitivity is null and protected_status is null and is_in_taiwan and id <> " +
          String(before),
      );
      await tx`update reports
                  set taxon_id = ${after},
                      precision_override = case
                        when taxon_id is null then null
                        else precision_override
                      end
                where id = ${r.id}`;
      const [row] = await tx`select precision_override, location_precision
                               from reports where id = ${r.id}`;
      assert.equal(row.precision_override, "coarse_10km", "a decision, not a stamp");
      assert.equal(row.location_precision, "coarse_10km", "and it still applies");
    });
  });
});
