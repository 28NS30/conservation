/**
 * What kind of record this is, once somebody says what the animal was.
 *
 * `category` is the page a report was filed on, fixed at submission. For a
 * while it was also rewritten when a moderator confirmed the species
 * (`recategorise`), so that a `sighting` confirmed to be an invasive species
 * would appear under the map's invasive filter. That copy drifted: the
 * classifier's own naming never rewrote it, and a TaiCOL refresh that changes a
 * species' invasive tag could not. So the record was right about the animal
 * and, depending on which path had named it, wrong about what kind of record
 * it was.
 *
 * Whether a record is invasive is now read from its species every time it is
 * shown (`reports_public.is_invasive`, 0016). These pin both halves: nothing
 * rewrites the category, and the species alone moves a record into or out of
 * the invasive collection.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as shared from "@conservation/shared";
import { sql, inRollback, insertReport } from "./helpers.mjs";

const { conditionOf, deriveCategory, selectionFor } = shared;

after(() => sql.end());

describe("the condition a stored category implies", () => {
  for (const [category, condition] of [
    ["roadkill", "dead"],
    ["injured", "hurt"],
    ["sighting", "well"],
    ["invasive", "well"],
  ]) {
    test(`${category} -> ${condition}`, () =>
      assert.equal(conditionOf(category), condition));
  }

  test("it round-trips through deriveCategory for every category", () => {
    // The inverse has to be a real inverse, or a record read back through it
    // (the export's vitality, for one) could say something the category does not.
    for (const c of ["roadkill", "injured", "sighting", "invasive"]) {
      const again = deriveCategory(conditionOf(c), {
        taxonIsInvasive: c === "invasive" ? true : c === "sighting" ? false : null,
        saysIntroduced: c === "invasive",
      });
      assert.equal(again, c, `${c} did not survive the round trip`);
    }
  });
});

describe("naming a species does not rewrite the category", () => {
  test("there is no function left that would", () => {
    // Its return is how the drift came back last time: a helper that exists
    // gets called from the next path someone writes.
    assert.equal("recategorise" in shared, false);
  });

  const WEB = join(import.meta.dirname, "..");
  /** A source file with its comments removed, which explain the old rule by name. */
  const code = (...p) =>
    readFileSync(join(WEB, ...p), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  for (const [name, file] of [
    ["confirmSpecies", ["app", "[locale]", "(site)", "reports", "[id]", "actions.ts"]],
    ["setReportTaxon", ["app", "[locale]", "(site)", "admin", "actions.ts"]],
    ["the classifier", ["lib", "report", "classifyWorker.ts"]],
  ])
    test(`${name} sets the species and leaves the category alone`, () => {
      const src = code(...file);
      assert.match(src, /set taxon_id = \$\{/, `${name} no longer sets a taxon?`);
      assert.doesNotMatch(src, /recategorise/, `${name} re-derives the category`);
      assert.doesNotMatch(
        src,
        /\bcategory\s*=\s*\$\{/,
        `${name} writes the category`,
      );
    });
});

describe("the species decides the collection, at read time", () => {
  let seq = 0;
  /** A taxon of our own, so the test does not depend on the fixture's names. */
  async function taxon(tx, { invasive, kingdom = "Animalia", status = "accepted" }) {
    const [t] = await tx`
      insert into taxa (taicol_id, scientific_name, rank, kingdom, is_in_taiwan,
                        taxon_status, is_invasive, alien_type)
      values (${`test-rc-${process.pid}-${Date.now()}-${seq++}`},
              ${`Testudofixtura rc${process.pid}x${seq}`}, 'Species', ${kingdom}, true,
              ${status}, ${invasive}, ${invasive ? "invasive" : "native"})
      returning id`;
    return t.id;
  }
  const isInvasive = async (tx, id) => {
    const [row] = await tx`select is_invasive from reports_public where id = ${id}::uuid`;
    return row?.is_invasive;
  };
  /** Whether the record is in a collection, by the reading every query shares. */
  const inCollection = async (tx, id, collection) => {
    const { categories, invasiveOnly } = selectionFor({ collection });
    const [row] = await tx`
      select count(*)::int as n from reports_public rp
       where rp.id = ${id}::uuid
         and (${categories}::text[] is null or rp.category = any(${categories}))
         and (not ${invasiveOnly}::boolean or rp.is_invasive)`;
    return row.n === 1;
  };

  test("a sighting named as an invasive species joins the invasive collection as a sighting", async () => {
    await inRollback(async (tx) => {
      const native = await taxon(tx, { invasive: false });
      const invasive = await taxon(tx, { invasive: true });
      const r = await insertReport(tx, { taxonId: native, category: "sighting" });
      assert.equal(await inCollection(tx, r.id, "invasive"), false, "fixture: starts native");

      // What the confirm paths write now: the taxon, and nothing else.
      await tx`update reports set taxon_id = ${invasive} where id = ${r.id}::uuid`;

      const [row] = await tx`select category from reports where id = ${r.id}::uuid`;
      assert.equal(row.category, "sighting", "the page it was filed on stands");
      assert.equal(await isInvasive(tx, r.id), true);
      assert.equal(await inCollection(tx, r.id, "invasive"), true);
      assert.equal(await inCollection(tx, r.id, "wildlife"), true, "still a live animal");
    });
  });

  test("filed as invasive and named as a native, it leaves the invasive collection", async () => {
    // The widen control on the invasive page used to store a native species
    // under category `invasive`, and the map's invasive filter showed it. The
    // species outranks the page.
    await inRollback(async (tx) => {
      const native = await taxon(tx, { invasive: false });
      const r = await insertReport(tx, { taxonId: native, category: "invasive" });
      assert.equal(await isInvasive(tx, r.id), false);
      assert.equal(await inCollection(tx, r.id, "invasive"), false);
      assert.equal(await inCollection(tx, r.id, "wildlife"), true);
    });
  });

  test("a TaiCOL refresh that changes the tag moves every record at once", async () => {
    // The path `recategorise` could never reach: nothing ran it when `taxa`
    // changed, so a species newly tagged invasive left its records out.
    await inRollback(async (tx) => {
      const later = await taxon(tx, { invasive: false });
      const r = await insertReport(tx, { taxonId: later, category: "roadkill" });
      assert.equal(await inCollection(tx, r.id, "invasive"), false);
      await tx`update taxa set is_invasive = true, alien_type = 'invasive' where id = ${later}`;
      assert.equal(await inCollection(tx, r.id, "invasive"), true, "a road-killed invasive counts");
      assert.equal(await inCollection(tx, r.id, "roadkill"), true);
    });
  });
});
