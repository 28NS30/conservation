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

describe("a species the model may name comes from a list that holds every protected animal", () => {
  // A softmax over a list without the right answer puts its weight on the
  // nearest wrong one. Scored against the roadkill list, which dropped every
  // marine-only taxon, a stranded 綠蠵龜 filed as injured could only be named
  // as some land or freshwater animal, and in the high band it would be
  // published under that animal's blur. CI has no model, so the Python that
  // chooses the list is read as source.
  const py = code(LABELSETS);
  const forCategory = py.slice(py.indexOf("def for_category"));
  /** Each `if category ...:` branch, with the categories it names. */
  const branches = forCategory
    .split(/\n\s*if category /)
    .slice(1)
    .map((b) => ({
      names: [...b.slice(0, b.indexOf(":")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]),
      body: b,
    }));

  test("the model service narrows some categories, so this is not vacuous", () => {
    assert.deepEqual(branches.flatMap((b) => b.names).sort(), ["invasive", "roadkill"]);
  });

  test("a narrowed category that may name a species keeps every protected taxon", () => {
    for (const { names, body } of branches) {
      if (!names.some((c) => AUTO_ASSIGN_CATEGORIES.has(c))) continue;
      assert.match(
        body,
        /keep = [^\n]*\| self\._protected/,
        `${names.join("/")} may be named by the model, but its list can drop a protected animal`,
      );
    }
  });

  test("an injured animal is scored against the whole checklist", () => {
    // In no branch, so it falls through to every Taiwan taxon.
    assert.ok(!branches.some((b) => b.names.includes("injured")));
  });

  test("and the website sends the page's own category, not a narrower one", () => {
    assert.match(code(ROUTE), /callModel\(bytes\.toString\("base64"\), job\.category\)/);
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

  async function row(
    tx,
    name,
    { rank = "Species", status = "accepted", protectedStatus = null, sensitivity = null, kingdom = null } = {},
  ) {
    const [t] = await tx`
      insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan,
                        taxon_status, protected_status, sensitivity, kingdom)
      values (${`test-cp-${process.pid}-${Date.now()}-${seq++}`}, ${name}, ${rank},
              true, ${status}, ${protectedStatus}, ${sensitivity}, ${kingdom})
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

  test("a namesake in another kingdom is not a sibling", async () => {
    // 'Ormosia formosana' is a tree rated 輕度 and a crane fly nobody rates. A
    // photograph the model calls the fly is a photograph of an insect.
    await inRollback(async (tx) => {
      const name = genus();
      const fly = await row(tx, name, { kingdom: "Animalia" });
      await row(tx, name, { kingdom: "Plantae", sensitivity: "輕度" });
      const r = await insertReport(tx, { taxonId: null, override: "coarse_10km" });
      const [after_] = await assign(tx, r.id, fly);
      assert.equal(after_.precision_override, null);
      assert.equal(after_.location_precision, "exact");
    });
  });

  test("but a row whose kingdom is unknown still counts", async () => {
    // A gap in the data must keep a sibling in, never leave one out.
    await inRollback(async (tx) => {
      const name = genus();
      const named = await row(tx, name, { kingdom: "Animalia" });
      await row(tx, name, { status: "deleted", protectedStatus: "II" });
      const r = await insertReport(tx, { taxonId: null, override: "coarse_10km" });
      const [after_] = await assign(tx, r.id, named);
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

describe("a record the model only made suggestions for", () => {
  // Its page lists the suggestions publicly beside its location. Published at
  // the unidentified 10 km whatever they were, a medium-band photograph of a
  // 重度 animal read "probably X" at a fifth of the blur X's own record gets.
  let seq = 0;
  const genus = () => `Testudofixtura g${process.pid}x${Date.now()}x${seq++}`;
  async function row(tx, { sensitivity = null } = {}) {
    const [t] = await tx`
      insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan, taxon_status, sensitivity)
      values (${`test-sg-${process.pid}-${Date.now()}-${seq++}`}, ${genus()}, 'Species',
              true, 'accepted', ${sensitivity})
      returning id`;
    return t.id;
  }
  async function candidates(tx, reportId, ids) {
    for (const [i, id] of ids.entries())
      await tx`insert into classifications (report_id, taxon_id, score, rank, model_version)
               values (${reportId}::uuid, ${id}, 0.2, ${i + 1}, 'test')`;
  }
  /** The suggest branch's statement, reduced to the column under test. */
  const suggest = (tx, reportId, shown) => tx`
    update reports
       set precision_override = ${
         shown
           ? tx`stricter_precision(precision_override, stricter_precision('coarse_10km'::text,
                  (select c.p
                     from (select binomial_precision(c.taxon_id) as p
                             from classifications c
                            where c.report_id = ${reportId}::uuid) c
                    order by precision_rank(c.p) desc
                    limit 1)))`
           : tx`stricter_precision(precision_override, 'coarse_10km'::text)`
       }
     where id = ${reportId}::uuid
    returning location_precision`;

  test("the route blurs through suggestionOverride, keyed on whether the list is shown", () => {
    assert.match(
      code(ROUTE),
      /precision_override = \$\{suggestionOverride\(\s*job\.report_id,\s*result\.band !== "low",?\s*\)\}/,
    );
    const helper = code(PRECISION).slice(code(PRECISION).indexOf("suggestionOverride ="));
    assert.match(helper, /stricter_precision\(precision_override, stricter_precision\(/);
    assert.match(helper, /binomial_precision\(c\.taxon_id\)[\s\S]*?where c\.report_id = \$\{reportId\}::uuid/);
  });

  test("is blurred as hard as the strictest species it shows", async () => {
    await inRollback(async (tx) => {
      const r = await insertReport(tx, { taxonId: null, override: "coarse_10km" });
      await candidates(tx, r.id, [await row(tx), await row(tx, { sensitivity: "重度" })]);
      const [after_] = await suggest(tx, r.id, true);
      assert.equal(after_.location_precision, "coarse_50km");
    });
  });

  test("but not for a list nobody is shown", async () => {
    await inRollback(async (tx) => {
      const r = await insertReport(tx, { taxonId: null, override: "coarse_10km" });
      await candidates(tx, r.id, [await row(tx, { sensitivity: "重度" })]);
      const [after_] = await suggest(tx, r.id, false);
      assert.equal(after_.location_precision, "coarse_10km");
    });
  });

  test("and never looser than it was already held", async () => {
    await inRollback(async (tx) => {
      const r = await insertReport(tx, { taxonId: null, override: "coarse_50km" });
      await candidates(tx, r.id, [await row(tx)]);
      for (const shown of [true, false]) {
        const [after_] = await suggest(tx, r.id, shown);
        assert.equal(after_.location_precision, "coarse_50km");
      }
    });
  });
});
