/**
 * A record named above the species is blurred at least 10 km. Migration 0033.
 *
 * TaiCOL rates species rows and the law lists species, so a genus, a family or
 * an order carries no rating, and taxon_precision() climbs from a subspecies
 * up to its species and no further. A record filed under a genus therefore
 * read "unrated" and was published to the metre: 246 genera recorded in
 * Taiwan hold a protected species, Prionailurus (石虎's) among them. Nobody
 * can file one that way through the form today, but a GBIF import, a
 * moderator or a model's labels could, so the rule is in the database.
 *
 * Every test builds its own taxa inside a rolled-back transaction, so it
 * asserts the rule rather than whatever TaiCOL happens to say this month.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback, insertReport } from "./helpers.mjs";

after(() => sql.end());

const MIGRATION = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "supabase", "migrations",
       "0033_blur_disagreements_and_higher_ranks.sql"),
  "utf8",
);

let seq = 0;
const uid = () => `test-as-${process.pid}-${Date.now()}-${seq++}`;
/** A name no real taxon shares, so the binomial rule sees only this test's rows. */
const name = () => `Testudofixtura a${process.pid}x${Date.now()}x${seq++}`;

async function taxon(tx, { rank = "Species", parent = null, sensitivity = null, protectedStatus = null, scientificName = name() } = {}) {
  const [t] = await tx`
    insert into taxa (taicol_id, parent_taicol_id, scientific_name, rank,
                      is_in_taiwan, sensitivity, protected_status, taxon_status)
    values (${uid()}, ${parent}, ${scientificName}, ${rank}, true,
            ${sensitivity}, ${protectedStatus}, 'accepted')
    returning id, taicol_id, scientific_name`;
  return t;
}

const precisionOf = async (tx, id) =>
  (await tx`select location_precision from reports where id = ${id}`)[0].location_precision;

describe("a name above the species", () => {
  for (const rank of ["Genus", "Family", "Order", "Subgenus", "Tribe", "Unranked"]) {
    test(`a record named at a ${rank} is blurred to 10 km`, async () => {
      await inRollback(async (tx) => {
        const t = await taxon(tx, { rank });
        const r = await insertReport(tx, { taxonId: t.id });
        assert.equal(r.location_precision, "coarse_10km",
          `a record named only to a ${rank} was published to the metre`);
        assert.ok(r.offset_m > 0, "the public point is the true one");
      });
    });
  }

  test("a rank TaiCOL left empty counts as above", async () => {
    // A gap in the data blurs; it never publishes.
    await inRollback(async (tx) => {
      const t = await taxon(tx, { rank: null });
      const r = await insertReport(tx, { taxonId: t.id });
      assert.equal(r.location_precision, "coarse_10km");
    });
  });

  test("the genus of a protected species, as the case that prompted it", async () => {
    await inRollback(async (tx) => {
      const g = await taxon(tx, { rank: "Genus", scientificName: `Testudogenus${process.pid}x${seq++}` });
      await taxon(tx, { parent: g.taicol_id, scientificName: `${g.scientific_name} felina`, protectedStatus: "I" });
      const r = await insertReport(tx, { taxonId: g.id });
      assert.equal(r.location_precision, "coarse_10km");
    });
  });

  test("10 km is a floor, not a cap: a genus's own stricter rating still holds", async () => {
    await inRollback(async (tx) => {
      const g = await taxon(tx, { rank: "Genus", sensitivity: "重度" });
      const r = await insertReport(tx, { taxonId: g.id });
      assert.equal(r.location_precision, "coarse_50km");
    });
  });

  test("and so does a floor on it", async () => {
    await inRollback(async (tx) => {
      const g = await taxon(tx, { rank: "Family" });
      await tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
               values (${g.taicol_id}, 'suppressed', 'test: a floor stricter than the rank rule')`;
      const r = await insertReport(tx, { taxonId: g.id });
      assert.equal(r.location_precision, "suppressed");
    });
  });

  test("and the record's own override", async () => {
    await inRollback(async (tx) => {
      const g = await taxon(tx, { rank: "Genus" });
      const r = await insertReport(tx, { taxonId: g.id, override: "coarse_50km" });
      assert.equal(r.location_precision, "coarse_50km");
    });
  });
});

describe("a species, a part of one, and a hybrid are unchanged", () => {
  for (const rank of ["Species", "Subspecies", "Variety", "Form", "Special Form", "Hybrid Formula"]) {
    test(`an unrated ${rank} is published as its rule says`, async () => {
      await inRollback(async (tx) => {
        const sp = await taxon(tx);
        const t = rank === "Species" ? sp : await taxon(tx, { rank, parent: sp.taicol_id });
        const r = await insertReport(tx, { taxonId: t.id });
        assert.equal(r.location_precision, "exact");
      });
    });
  }

  test("a subspecies still climbs to its species, and stops there", async () => {
    // The rank term reads the row a record is named under, not the rows the
    // climb passes through: a species under a genus is not blurred for it.
    await inRollback(async (tx) => {
      const g = await taxon(tx, { rank: "Genus" });
      const sp = await taxon(tx, { parent: g.taicol_id });
      const ssp = await taxon(tx, { rank: "Subspecies", parent: sp.taicol_id });
      const r = await insertReport(tx, { taxonId: ssp.id });
      assert.equal(r.location_precision, "exact");
    });
  });
});

describe("every rule that asks taxon_precision agrees", () => {
  test("the species page's notice and binomial_precision say 10 km", async () => {
    await inRollback(async (tx) => {
      const g = await taxon(tx, { rank: "Genus" });
      const [row] = await tx`select taxon_precision(${g.id}) as own, binomial_precision(${g.id}) as photo`;
      assert.deepEqual({ ...row }, { own: "coarse_10km", photo: "coarse_10km" });
    });
  });

  test("a model's suggestion list naming a genus is withheld beside an exact point", async () => {
    // report_ai_suggestions withholds a list any member of which needs more
    // blur than the record has (0025).
    await inRollback(async (tx) => {
      const sp = await taxon(tx);
      const g = await taxon(tx, { rank: "Genus" });
      const r = await insertReport(tx, { taxonId: sp.id });
      await tx`insert into classifications (report_id, taxon_id, score, rank, model_version)
               values (${r.id}::uuid, ${g.id}, 0.9, 1, 'test')`;
      const [{ ok }] = await tx`select suggestions_within_blur(${r.id}::uuid, 'exact') as ok`;
      assert.equal(ok, false);
    });
  });

  test("a row re-ranked above the species re-blurs its records, through the existing trigger", async () => {
    // The migration re-blurs the records already published through the same
    // tighten_reports() this trigger calls, which can only tighten.
    await inRollback(async (tx) => {
      const t = await taxon(tx);
      const r = await insertReport(tx, { taxonId: t.id });
      assert.equal(r.location_precision, "exact", "fixture precondition");
      await tx`update taxa set rank = 'Genus' where id = ${t.id}`;
      assert.equal(await precisionOf(tx, r.id), "coarse_10km");
    });
  });
});

describe("the migration", () => {
  test("is live: taxon_precision asks the rank", async () => {
    // The check that proves 0033 is applied, as lib/schemaStatus.ts asks its
    // rule checks: the live function body, not whether an object exists.
    const [{ ok }] = await sql`
      select exists (select 1 from pg_proc
                      where proname = 'taxon_precision'
                        and prosrc like '%is_above_species(%') as ok`;
    assert.ok(ok, "0033 is not applied to this database");
  });

  test("re-blurs through the functions that never loosen, and refuses to loosen", () => {
    assert.match(MIGRATION, /select tighten_reports\(array\(/);
    assert.match(MIGRATION, /select tighten_binomial_siblings\(array\(/);
    assert.match(MIGRATION, /raise exception '0033 would loosen % record\(s\)'/);
    assert.match(MIGRATION, /precision_rank\(r\.location_precision\) < precision_rank\(b\.location_precision\)/);
    assert.match(MIGRATION, /set local lock_timeout = '5s';/);
  });

  test("keeps the new function off the REST API (0024)", async () => {
    const [{ anon }] = await sql`
      select case when not exists (select 1 from pg_roles where rolname = 'anon') then false
                  else has_function_privilege('anon', 'public.is_above_species(text)', 'execute')
             end as anon`;
    assert.equal(anon, false);
  });
});
