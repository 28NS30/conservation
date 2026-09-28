/**
 * The evidence contract: the model returns evidence, the website decides.
 *
 * With ML_CONTRACT=2 the model service scores a photograph against every
 * accepted Taiwan taxon and returns its top 50 species; which of them each
 * kind of report may be named as, how sure the model must be, and whether an
 * answer is only ever a suggestion are rules in lib/report/classifyPolicy.ts,
 * applied to live `taxa` rows. Each test here is written against a way those
 * rules have gone wrong, or nearly did, and fails if it is put back:
 *
 *   - the invasive page scored against the invasive register alone, and 100 of
 *     276 native animals came back as an invasive species in the high band;
 *   - an injured animal judged by a list that could not hold it;
 *   - the model naming a species on a page that has not proven it right at
 *     least 95% of the time (the team's rule);
 *   - a score re-normalised over what a page keeps, which turns 0.01 into 1.0;
 *   - the website's copy of the rules drifting from the one that fitted the
 *     thresholds.
 *
 * CI has no model and no photograph, so the rules are tested pure, the route is
 * checked to use them, and the candidate lookup is run on the database.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback, insertReport } from "./helpers.mjs";
import {
  AUTO_ASSIGN_CATEGORIES,
  BLUR_OF_SHOWN_SQL,
  NEVER_AUTO_ASSIGN_CLASSES,
  PROFILE_THRESHOLDS,
  RESOLVE_CANDIDATES_SQL,
  SHOWN,
  THRESHOLDS_MODEL_VERSION,
  bandOf,
  decideFromEvidence,
  disagreesWithPerson,
  guardCongeners,
  mayBeNamedAs,
  mlContract,
  parseEvidence,
  profileOf,
  toCandidates,
} from "../lib/report/classifyPolicy.ts";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const ML = join(WEB, "..", "ml");
const read = (...p) => readFileSync(join(...p), "utf8");
const FITTED = JSON.parse(read(WEB, "lib", "report", "classifier-thresholds.json"));
const SHARED = JSON.parse(read(ML, "testdata", "profile_cases.json"));
const CASES = SHARED.cases;
const GUARD_CASES = SHARED.guardCases;
const ROUTE = read(WEB, "app", "api", "jobs", "classify", "route.ts");
const EVIDENCE = read(WEB, "lib", "report", "classifyEvidence.ts");
const POLICY = read(WEB, "lib", "report", "classifyPolicy.ts");
const EVALUATE = read(ML, "evaluate.py");

/** Source with comment lines dropped, so an assertion never matches prose. */
const code = (src) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|--|#)/.test(l))
    .join("\n");

let seq = 0;
/** A resolved candidate: a land reptile nobody protects, unless told otherwise. */
function cand(over = {}) {
  seq++;
  return {
    taxonId: 900000 + seq,
    taicolId: `tFixture${String(seq).padStart(4, "0")}`,
    scientificName: `Fixturus species${seq}`,
    score: 0.5,
    kingdom: "Animalia",
    className: "Reptilia",
    isInvasive: false,
    hasInvasiveInfraspecific: false,
    isMarine: null,
    isTerrestrial: true,
    isProtected: false,
    recordedOnRoads: false,
    ...over,
  };
}

const decide = (category, candidates, extra = {}) =>
  decideFromEvidence({
    category,
    candidates,
    humanIdentified: false,
    modelVersion: THRESHOLDS_MODEL_VERSION,
    ...extra,
  });

/** A score the profile calls high, or null when nothing is high for it. */
const highFor = (profile) => PROFILE_THRESHOLDS[profile].high;

describe("each stored category is judged by its own rule set", () => {
  test("roadkill and injured by the roadkill set, sightings by wildlife, invasive by invasive", () => {
    assert.equal(profileOf("roadkill"), "roadkill");
    assert.equal(profileOf("injured"), "roadkill");
    assert.equal(profileOf("sighting"), "wildlife");
    assert.equal(profileOf("invasive"), "invasive");
  });

  test("an injured animal is judged as roadkill, not against every animal", () => {
    const fish = cand({ score: 0.6, isMarine: true, isTerrestrial: false, className: "Actinopteri" });
    const snake = cand({ score: 0.3 });
    assert.equal(decide("injured", [fish, snake]).best?.taicolId, snake.taicolId);
    assert.equal(decide("sighting", [fish, snake]).best?.taicolId, fish.taicolId);
  });

  test("a category nobody has thought about yet only ever suggests", () => {
    assert.equal(profileOf("some-future-page"), "wildlife");
    const sure = cand({ score: 1 });
    assert.equal(decide("some-future-page", [sure]).action, "suggest");
    assert.ok(!AUTO_ASSIGN_CATEGORIES.has("some-future-page"));
  });
});

describe("the invasive page scores every animal, and only ever suggests", () => {
  test("a native animal on top is called native, whatever invasive species follows it", () => {
    // The closed list's failure: restricted to the invasive register, this
    // native tree frog came back as the invasive one at 0.98.
    const native = cand({ score: 0.9, scientificName: "Polypedates braueri", className: "Amphibia" });
    const invasive = cand({ score: 0.08, scientificName: "Polypedates megacephalus", isInvasive: true });
    const d = decide("invasive", [invasive, native]);
    assert.equal(d.best?.taicolId, native.taicolId);
    assert.equal(d.invasive, "native");
    assert.match(d.reason, /native animal/);
    assert.equal(d.action, "suggest");
  });

  test("an invasive animal on top is suspected, and still only suggested", () => {
    const iguana = cand({ score: 0.999, scientificName: "Iguana iguana", isInvasive: true });
    const d = decide("invasive", [iguana]);
    assert.equal(d.invasive, "suspected");
    assert.equal(d.action, "suggest");
    assert.match(d.reason, /suspects the invasive Iguana iguana; a person must confirm/);
  });

  test("a species with an invasive subspecies is neither invasive nor native", () => {
    const slider = cand({ score: 0.9, scientificName: "Trachemys scripta", hasInvasiveInfraspecific: true });
    const d = decide("invasive", [slider]);
    assert.equal(d.invasive, "mixed");
    assert.match(d.reason, /needs an expert/);
  });

  test("never named by the model, even if the thresholds file said it could", () => {
    // PR #77 made an invasive answer suggestion-only. Flip every switch the
    // thresholds file controls and it must still hold.
    const saved = { ...PROFILE_THRESHOLDS.invasive };
    try {
      Object.assign(PROFILE_THRESHOLDS.invasive, { high: 0, medium: 0, autoAssign: true });
      for (const score of [0.3, 0.8, 0.99, 1])
        for (const isInvasive of [true, false]) {
          const d = decide("invasive", [cand({ score, isInvasive })]);
          assert.notEqual(d.action, "assign", `score ${score}, invasive ${isInvasive}`);
        }
    } finally {
      Object.assign(PROFILE_THRESHOLDS.invasive, saved);
    }
    assert.equal(PROFILE_THRESHOLDS.invasive.autoAssign, false);
    assert.equal(FITTED.profiles.invasive.autoAssign, false);
    assert.ok(!AUTO_ASSIGN_CATEGORIES.has("invasive"));
  });
});

describe("no page names an invasive species by itself", () => {
  // A record's species decides whether it is in the invasive database. On the
  // live set a native 布氏樹蛙 scored 0.979 as the invasive 斑腿樹蛙 on the
  // wildlife rule set too.
  for (const category of ["sighting", "roadkill", "injured"]) {
    test(`${category}: an invasive answer, or one with an invasive form, is a suggestion`, () => {
      const saved = { ...PROFILE_THRESHOLDS[profileOf(category)] };
      try {
        Object.assign(PROFILE_THRESHOLDS[profileOf(category)], { high: 0.5, medium: 0.2, autoAssign: true });
        assert.equal(decide(category, [cand({ score: 0.99 })]).action, "assign", "the control must be named");
        for (const over of [{ isInvasive: true }, { hasInvasiveInfraspecific: true }]) {
          const d = decide(category, [cand({ score: 0.99, ...over })]);
          assert.equal(d.action, "suggest");
          assert.match(d.reason, /invasive form; a person must confirm/);
        }
      } finally {
        Object.assign(PROFILE_THRESHOLDS[profileOf(category)], saved);
      }
    });
  }
});

describe("what a page may be named as", () => {
  test("no page names a plant", () => {
    // Scored against the whole checklist, an owl once came back as a cypress.
    const cypress = cand({ kingdom: "Plantae", score: 0.78 });
    for (const p of ["roadkill", "wildlife", "invasive"]) assert.equal(mayBeNamedAs(p, cypress), false);
  });

  test("roadkill leaves out a marine-only animal", () => {
    const fish = cand({ isMarine: true, isTerrestrial: false });
    assert.equal(mayBeNamedAs("roadkill", fish), false);
    assert.equal(mayBeNamedAs("wildlife", fish), true);
  });

  test("but keeps a protected one: a sea turtle does cross a coastal road", () => {
    assert.equal(mayBeNamedAs("roadkill", cand({ isMarine: true, isTerrestrial: null, isProtected: true })), true);
  });

  test("and one TaiRON has found on a road, whatever its habitat flags say", () => {
    // 凶狠圓軸蟹: 272 TaiRON road records, flagged marine and not terrestrial.
    assert.equal(
      mayBeNamedAs("roadkill", cand({ isMarine: true, isTerrestrial: false, recordedOnRoads: true })),
      true,
    );
  });

  test("a missing habitat flag never drops a species", () => {
    assert.equal(mayBeNamedAs("roadkill", cand({ isMarine: null, isTerrestrial: null })), true);
  });
});

describe("scores are the model's own, never re-normalised", () => {
  test("an animal holding 1% of the mass behind a plant stays at 1%", () => {
    // Re-normalised over what the page keeps, 0.01 becomes 1.0 and is named
    // in the high band.
    const plant = cand({ kingdom: "Plantae", score: 0.95 });
    const animal = cand({ score: 0.01 });
    const d = decide("sighting", [plant, animal]);
    assert.equal(d.best?.score, 0.01);
    assert.equal(d.band, "low");
    assert.equal(d.action, "suggest");
  });
});

describe("bands and naming follow the fitted thresholds", () => {
  for (const profile of ["wildlife", "roadkill"]) {
    const category = profile === "wildlife" ? "sighting" : "roadkill";
    const t = PROFILE_THRESHOLDS[profile];

    test(`${profile}: named at the fitted threshold, suggested just below it`, () => {
      if (!t.autoAssign || t.high === null) {
        assert.equal(decide(category, [cand({ score: 0.99999 })]).action, "suggest",
          `${profile} is not proven, so it must never name a species`);
        return;
      }
      assert.equal(decide(category, [cand({ score: t.high })]).action, "assign");
      assert.equal(decide(category, [cand({ score: t.high - 1e-6 })]).action, "suggest");
    });

    test(`${profile}: the list is shown from the medium cutoff up`, () => {
      assert.equal(bandOf(profile, t.medium), "medium");
      assert.equal(bandOf(profile, t.medium - 1e-6), "low");
    });
  }

  test("the committed thresholds keep the team's rule: named only where proven right 95% of the time", () => {
    // "Proven": the lower end of the 95% interval, not the point estimate.
    // Fails if a profile is switched to naming species by hand, or the
    // target is lowered, without a measurement behind it.
    assert.ok(FITTED.targetPrecision >= 0.95, "the target is the team's 95%");
    for (const [name, p] of Object.entries(FITTED.profiles)) {
      if (!p.autoAssign) continue;
      assert.notEqual(p.high, null, `${name} names species but has no high threshold`);
      assert.equal(p.high, p.highFit.threshold, `${name}'s threshold is not the one it was measured at`);
      assert.ok(p.highFit.wilson95[0] >= FITTED.targetPrecision,
        `${name} names species at ${p.highFit.precision} precision, lower bound ${p.highFit.wilson95[0]}`);
      assert.ok(p.highFit.n >= 30, `${name}'s threshold rests on ${p.highFit.n} photos`);
    }
  });

  test("the thresholds were measured on the model that answers", () => {
    assert.equal(THRESHOLDS_MODEL_VERSION, "bioclip2-vitl14-v2");
    // Whatever the committed file says about wildlife, make it a profile that
    // names species, so the version check is what is being tested.
    const saved = { ...PROFILE_THRESHOLDS.wildlife };
    try {
      Object.assign(PROFILE_THRESHOLDS.wildlife, { high: 0.5, medium: 0.2, autoAssign: true });
      const sure = cand({ score: 1 });
      assert.equal(decide("sighting", [sure]).action, "assign");
      const d = decide("sighting", [sure], { modelVersion: "bioclip2-vitl14-v3" });
      assert.equal(d.action, "suggest", "thresholds fitted on one model named a species for another");
      assert.match(d.reason, /fitted for bioclip2-vitl14-v2/);
    } finally {
      Object.assign(PROFILE_THRESHOLDS.wildlife, saved);
    }
  });

  test("crabs are never named by the model unless they cleared the same bar", () => {
    const crabsProven = FITTED.crabs && FITTED.crabs.top1Wilson95[0] >= FITTED.targetPrecision;
    if (!crabsProven) assert.ok(NEVER_AUTO_ASSIGN_CLASSES.has("Malacostraca"));
    if (NEVER_AUTO_ASSIGN_CLASSES.has("Malacostraca")) {
      const crab = cand({ score: 1, className: "Malacostraca", recordedOnRoads: true });
      const d = decide("roadkill", [crab]);
      assert.equal(d.action, "suggest");
      if (PROFILE_THRESHOLDS.roadkill.high !== null) assert.match(d.reason, /only suggests Malacostraca/);
    }
  });
});

describe("a person's identification", () => {
  test("is only ever recorded beside", () => {
    for (const category of ["roadkill", "injured", "sighting", "invasive"])
      assert.equal(
        decide(category, [cand({ score: 1 })], { humanIdentified: true }).action,
        "record",
      );
  });

  test("disagreement is judged at the binomial, and only when the model is sure", () => {
    const bulbul = cand({ score: 1, scientificName: "Pycnonotus sinensis" });
    const sure = { ...decide("sighting", [bulbul], { humanIdentified: true }), band: "high" };
    assert.equal(disagreesWithPerson(sure, "Pycnonotus sinensis formosae"), false);
    assert.equal(disagreesWithPerson(sure, "Passer montanus"), true);
    assert.equal(disagreesWithPerson({ ...sure, band: "medium" }, "Passer montanus"), false);
    assert.equal(disagreesWithPerson(sure, null), false);
  });
});

describe("the suggestions kept are the ones a reporter is shown", () => {
  test(`the top ${SHOWN} the profile may name, most probable first`, () => {
    const many = Array.from({ length: 50 }, (_, i) => cand({ score: (50 - i) / 1000 }));
    const plants = many.slice(0, 3).map((c) => ({ ...c, kingdom: "Plantae" }));
    const d = decide("sighting", [...plants, ...many.slice(3)]);
    assert.equal(d.shown.length, SHOWN);
    assert.deepEqual(d.shown.map((c) => c.taicolId), many.slice(3, 3 + SHOWN).map((c) => c.taicolId));
  });
});

describe("the same cases the thresholds were fitted with", () => {
  // apps/ml/test_contract.py runs these against evaluate.py's copy of the rules.
  for (const c of CASES) {
    test(c.name, () => {
      const evidence = {
        contract: 2,
        modelVersion: THRESHOLDS_MODEL_VERSION,
        detectorHit: false,
        candidates: c.candidates.map((x) => ({ taicol_id: x.taicol_id, score: x.score })),
      };
      const rows = c.candidates.map((x, i) => ({
        id: i + 1,
        is_invasive: false,
        has_invasive_infraspecific: false,
        is_marine: null,
        is_terrestrial: null,
        is_protected: false,
        recorded_on_roads: false,
        ...x,
      }));
      const d = decide(c.category, toCandidates(evidence, rows));
      assert.equal(d.best?.taicolId ?? null, c.expect.best);
      assert.equal(d.invasive, c.expect.invasive);
    });
  }

  for (const c of GUARD_CASES) {
    test(`guard: ${c.name}`, () => {
      const shown = c.candidates.map((x, i) =>
        cand({ taicolId: x.taicol_id, score: x.score, scientificName: x.scientific_name, taxonId: i + 1 }),
      );
      const assigned = {
        profile: "wildlife",
        action: "assign",
        band: "high",
        best: shown[0],
        shown: shown.slice(0, SHOWN),
        invasive: null,
        reason: null,
      };
      const blurOf = new Map(c.candidates.map((x) => [x.taicol_id, x.blur]));
      const d = guardCongeners(assigned, blurOf);
      assert.equal(d.action, c.blocked ? "suggest" : "assign");
      if (c.blocked) assert.match(d.reason, /blurred more strictly; a person must confirm/);
    });
  }

  test("and the same candidate lookups", () => {
    const norm = (s) => s.replace(/\$1::text\[\]|%s/g, "?").replace(/\s+/g, " ").trim();
    const py = EVALUATE.match(/RESOLVE_SQL = """([\s\S]*?)"""/)[1];
    assert.equal(norm(py), norm(RESOLVE_CANDIDATES_SQL));
    const pyBlur = EVALUATE.match(/BLUR_SQL = """([\s\S]*?)"""/)[1];
    assert.equal(norm(pyBlur), norm(BLUR_OF_SHOWN_SQL));
  });

  test("the guard only ever turns a name into a suggestion", () => {
    const suggestion = { ...decide("sighting", [cand({ score: 0.1 })]) };
    assert.equal(guardCongeners(suggestion, new Map()), suggestion);
  });
});

describe("talking to the model service", () => {
  test("the legacy contract unless ML_CONTRACT is exactly 2", () => {
    assert.equal(mlContract({}), 1);
    assert.equal(mlContract({ ML_CONTRACT: "1" }), 1);
    assert.equal(mlContract({ ML_CONTRACT: "" }), 1);
    assert.equal(mlContract({ ML_CONTRACT: "true" }), 1);
    assert.equal(mlContract({ ML_CONTRACT: "2" }), 2);
    assert.equal(mlContract({ ML_CONTRACT: " 2\n" }), 2);
  });

  test("an answer in the old shape is an error, not an unidentified animal", () => {
    const legacy = { predictions: [{ taxon_id: 1, score: 0.9, rank: 1 }], band: "high", modelVersion: "v1" };
    assert.throws(() => parseEvidence(legacy), /did not answer in contract 2/);
    assert.throws(() => parseEvidence(null), /did not answer in contract 2/);
    assert.throws(
      () => parseEvidence({ contract: 2, candidates: [{ taicol_id: 7, score: 1 }], modelVersion: "x" }),
      /malformed/,
    );
    const ok = { contract: 2, candidates: [{ taicol_id: "t1", score: 0.5 }], modelVersion: "x", detectorHit: false };
    assert.equal(parseEvidence(ok), ok);
  });
});

describe("the worker runs these rules, through the same blur as before", () => {
  const route = code(ROUTE);
  const evidence = code(EVIDENCE);

  test("it asks for contract 2 only when switched, and sends no category with it", () => {
    assert.match(route, /const contract = mlContract\(process\.env\)/);
    assert.match(route, /if \(contract === 2\)/);
    assert.match(route, /JSON\.stringify\(\{ token, imageBase64, contract: 2 \}\)/);
    assert.match(route, /return parseEvidence\(await res\.json\(\)\)/);
    // The legacy request is unchanged.
    assert.match(route, /JSON\.stringify\(\{ token, imageBase64, category \}\)/);
  });

  test("a species it names carries the binomial's strictest blur", () => {
    assert.match(evidence, /precision_override = \$\{photoIdentificationOverride\(best\.taxonId\)\}/);
    assert.match(evidence, /taxon_source = 'ai'/);
    assert.match(evidence, /status = case when status = 'pending' then 'published' else status end/);
  });

  test("a record it only suggests for is blurred as hard as its strictest suggestion", () => {
    assert.match(evidence, /precision_override = \$\{suggestionOverride\(job\.report_id, band !== "low"\)\}/);
  });

  test("before it names a species, it asks about stricter congeners", () => {
    assert.match(evidence, /if \(decision\.action === "assign"\) \{[\s\S]*?BLUR_OF_SHOWN_SQL[\s\S]*?decision = guardCongeners\(/);
    assert.ok(evidence.indexOf("guardCongeners(") < evidence.indexOf("sql.begin("),
      "the guard must run before anything is written");
  });

  test("it keeps the suggestions shown, not all fifty", () => {
    assert.match(evidence, /for \(const \[i, c\] of decision\.shown\.entries\(\)\)/);
    assert.doesNotMatch(evidence, /of result\.candidates/);
  });

  test("the invasive profile cannot reach the assign branch through the policy", () => {
    const decideSrc = code(POLICY).slice(code(POLICY).indexOf("export function decideFromEvidence"));
    assert.ok(
      decideSrc.indexOf('if (profile === "invasive")') < decideSrc.indexOf('action: "assign"'),
      "the invasive early return must come before any assignment",
    );
  });
});

describe("the candidate lookup, on the database", () => {
  async function taxon(tx, name, over = {}) {
    const taicol = `test-ce-${process.pid}-${Date.now()}-${seq++}`;
    const o = {
      rank: "Species",
      status: "accepted",
      kingdom: "Animalia",
      parent: null,
      invasive: false,
      marine: null,
      terrestrial: null,
      prot: null,
      ...over,
    };
    const [t] = await tx`
      insert into taxa (taicol_id, parent_taicol_id, scientific_name, rank, is_in_taiwan,
                        taxon_status, kingdom, is_invasive, is_marine, is_terrestrial, protected_status)
      values (${taicol}, ${o.parent}, ${name}, ${o.rank}, true, ${o.status}, ${o.kingdom},
              ${o.invasive}, ${o.marine}, ${o.terrestrial}, ${o.prot})
      returning id, taicol_id`;
    return t;
  }
  const lookup = (tx, ids) => tx.unsafe(RESOLVE_CANDIDATES_SQL, [ids]);

  test("an invasive subspecies marks its species mixed; a deleted row is not an answer", async () => {
    await inRollback(async (tx) => {
      const name = `Fixturus mixtus${process.pid}`;
      const sp = await taxon(tx, name);
      await taxon(tx, `${name} introductus`, { rank: "Subspecies", parent: sp.taicol_id, invasive: true });
      const gone = await taxon(tx, `Fixturus deletus${process.pid}`, { status: "deleted" });
      const rows = await lookup(tx, [sp.taicol_id, gone.taicol_id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].taicol_id, sp.taicol_id);
      assert.equal(rows[0].has_invasive_infraspecific, true);
      assert.equal(rows[0].is_invasive, false);
    });
  });

  test("TaiRON's road records put a species on the roadkill list; a report filed here does not", async () => {
    await inRollback(async (tx) => {
      const crab = await taxon(tx, `Fixturus cancer${process.pid}`, { marine: true, terrestrial: false });
      const fish = await taxon(tx, `Fixturus piscis${process.pid}`, { marine: true, terrestrial: false });
      await tx`
        insert into reports (category, location, location_public, observed_at, taxon_id, taxon_source, status, source)
        values ('roadkill', st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
                st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography, now(), ${crab.id},
                'imported', 'published', 'gbif')`;
      await insertReport(tx, { taxonId: fish.id, category: "roadkill" }); // source 'user'
      const rows = await lookup(tx, [crab.taicol_id, fish.taicol_id]);
      const by = Object.fromEntries(rows.map((r) => [r.taicol_id, r]));
      assert.equal(by[crab.taicol_id].recorded_on_roads, true);
      assert.equal(by[fish.taicol_id].recorded_on_roads, false);
    });
  });
});
