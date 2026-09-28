/**
 * What the classifier may do with an answer, before the first real report.
 *
 * The model has never identified a real photograph. Set up as it was, the
 * first invasive-species report would have been named from a closed list —
 * TaiCOL's invasive register, nothing else — and published under that name.
 * Measured on 308 cached photos, 100 of 276 native animals came back as an
 * invasive species in the high band, a native 布氏樹蛙 at 1.0 as the invasive
 * 斑腿樹蛙. And when the model does name a species, which of several rows
 * sharing a binomial it lands on is noise, while those rows need not carry the
 * same blur.
 *
 * The decision itself is pure (lib/report/classifyPolicy.ts) and tested as
 * such; the route is checked to use it, since CI has no model, no photograph
 * and no storage to run the route with. The blur is SQL, tested on a database.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback, insertReport } from "./helpers.mjs";
import {
  classifierAction,
  labelSetFor,
  AUTO_ASSIGN_CATEGORIES,
} from "../lib/report/classifyPolicy.ts";

after(() => sql.end());

const read = (...p) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
const ROUTE = read("app", "api", "jobs", "classify", "route.ts");
const PRECISION = read("lib", "report", "precision.ts");
const LABELSETS = readFileSync(
  join(import.meta.dirname, "..", "..", "ml", "labelsets.py"),
  "utf8",
);
/** Source with comment lines dropped, so an assertion never matches prose. */
const code = (src) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|--|#)/.test(l))
    .join("\n");

const BANDS = ["high", "medium", "low"];

describe("an invasive report is never named by the model", () => {
  for (const band of BANDS) {
    test(`not in the ${band} band`, () => {
      assert.notEqual(
        classifierAction({
          category: "invasive",
          band,
          hasPrediction: true,
          humanIdentified: false,
        }),
        "assign",
        "an answer from a closed list reached the auto-assign branch",
      );
    });
  }

  test("its answer is kept as a suggestion", () => {
    assert.equal(
      classifierAction({
        category: "invasive",
        band: "high",
        hasPrediction: true,
        humanIdentified: false,
      }),
      "suggest",
    );
  });

  test("and a category nobody has thought about yet starts out the same way", () => {
    // An allowlist, so adding a category does not quietly add auto-assignment.
    assert.equal(
      classifierAction({
        category: "some-future-page",
        band: "high",
        hasPrediction: true,
        humanIdentified: false,
      }),
      "suggest",
    );
    assert.ok(!AUTO_ASSIGN_CATEGORIES.has("invasive"));
  });
});

describe("the other pages are unchanged", () => {
  for (const category of ["roadkill", "injured", "sighting"]) {
    test(`${category}: confident is named, unsure is suggested`, () => {
      const at = (band) =>
        classifierAction({ category, band, hasPrediction: true, humanIdentified: false });
      assert.equal(at("high"), "assign");
      assert.equal(at("medium"), "suggest");
      assert.equal(at("low"), "suggest");
    });
  }

  test("a person's identification is only ever recorded beside", () => {
    for (const category of ["roadkill", "injured", "sighting", "invasive"])
      for (const band of BANDS)
        assert.equal(
          classifierAction({ category, band, hasPrediction: true, humanIdentified: true }),
          "record",
        );
  });

  test("no prediction names nothing", () => {
    assert.equal(
      classifierAction({
        category: "roadkill",
        band: "high",
        hasPrediction: false,
        humanIdentified: false,
      }),
      "suggest",
    );
  });
});

describe("an injured animal is scored like a dead one", () => {
  test("the website asks for the roadkill label list", () => {
    assert.equal(labelSetFor("injured"), "roadkill");
    for (const c of ["roadkill", "invasive", "sighting"]) assert.equal(labelSetFor(c), c);
  });

  test("and so does the model service, for anything calling it directly", () => {
    assert.match(code(LABELSETS), /if category in \("roadkill", "injured"\):/);
  });
});

describe("the route decides through the policy, not beside it", () => {
  const route = code(ROUTE);

  test("it asks classifierAction and branches on its answer", () => {
    assert.match(route, /classifierAction\(\{/);
    assert.match(route, /if \(action === "assign"\)/);
    // The old inline test, which knew nothing of the category.
    assert.doesNotMatch(route, /AUTO_ASSIGN_BANDS\.has\(result\.band\) && !humanIdentified/);
  });

  test("it sends the label set, not the raw category, to the model", () => {
    assert.match(route, /callModel\(\s*bytes\.toString\("base64"\),\s*labelSetFor\(job\.category\),?\s*\)/);
  });

  test("a species it names carries the binomial's strictest blur", () => {
    assert.match(route, /precision_override = \$\{photoIdentificationOverride\(best\.taxon_id\)\}/);
    assert.match(
      code(PRECISION),
      /photoIdentificationOverride = \(taxonId: number\) =>\s*sql`stricter_precision\(\$\{keepDeliberateOverride\(\)\}, binomial_precision_floor\(\$\{taxonId\}\)\)`/,
    );
  });
});

describe("a species named from a photograph is never blurred less than a row sharing its name", () => {
  let seq = 0;
  const genus = () => `Testudofixtura s${process.pid}x${Date.now()}x${seq++}`;

  async function row(tx, name, { rank = "Species", status = "accepted", protectedStatus = null, sensitivity = null } = {}) {
    const [t] = await tx`
      insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan,
                        taxon_status, protected_status, sensitivity)
      values (${`test-cp-${process.pid}-${Date.now()}-${seq++}`}, ${name}, ${rank},
              true, ${status}, ${protectedStatus}, ${sensitivity})
      returning id`;
    return t.id;
  }

  /** The assign branch's statement, reduced to the columns under test. */
  const assign = (tx, reportId, taxonId) => tx`
    update reports
       set taxon_id = ${taxonId},
           taxon_source = 'ai',
           precision_override = stricter_precision(
             case when taxon_id is null then null else precision_override end,
             binomial_precision_floor(${taxonId}))
     where id = ${reportId}
    returning precision_override, location_precision`;

  test("the duplicate-row trap: two rows, one name, one protected", async () => {
    // How TaiCOL keeps a retired name: a second row with the same scientific
    // name, and not necessarily the same rating.
    await inRollback(async (tx) => {
      const name = genus();
      const open = await row(tx, name);
      await row(tx, name, { status: "deleted", protectedStatus: "II" });
      const r = await insertReport(tx, { taxonId: null, override: "coarse_10km" });
      const [after_] = await assign(tx, r.id, open);
      assert.equal(after_.location_precision, "coarse_10km",
        "the model named the unrated twin and the record was published exactly");
    });
  });

  test("a protected subspecies blurs a model's answer of its species", async () => {
    // 環頸雉: the endemic subspecies is protected, the introduced ones are not,
    // and a photograph cannot tell them apart.
    await inRollback(async (tx) => {
      const name = genus();
      const species = await row(tx, name);
      await row(tx, `${name} endemica`, { rank: "Subspecies", sensitivity: "重度" });
      const r = await insertReport(tx, { taxonId: null, override: "coarse_10km" });
      const [after_] = await assign(tx, r.id, species);
      assert.equal(after_.location_precision, "coarse_50km");
    });
  });

  test("nothing is stamped when the named row is already the strictest", async () => {
    // A stamp outlives a moderator's correction; one that adds nothing would
    // keep a record blurred after it was corrected to a species that needs none.
    await inRollback(async (tx) => {
      const name = genus();
      const strict = await row(tx, name, { sensitivity: "輕度" });
      await row(tx, `${name} vulgaris`, { rank: "Subspecies" });
      const r = await insertReport(tx, { taxonId: null, override: "coarse_10km" });
      const [after_] = await assign(tx, r.id, strict);
      assert.equal(after_.precision_override, null);
      assert.equal(after_.location_precision, "coarse_10km");
    });
  });

  test("and a species with no stricter sibling is published as its rule says", async () => {
    await inRollback(async (tx) => {
      const alone = await row(tx, genus());
      const r = await insertReport(tx, { taxonId: null, override: "coarse_10km" });
      const [after_] = await assign(tx, r.id, alone);
      assert.equal(after_.precision_override, null);
      assert.equal(after_.location_precision, "exact");
    });
  });
});
