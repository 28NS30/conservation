/**
 * A record is blurred by the strictest rule that applies to it. Migration 0014.
 *
 * Until 0014 one row decided: the record's own taxon. Three ways that row can
 * be too lenient were live, and each published a protected animal to the
 * metre:
 *
 *   - TaiCOL rates sensitivity on SPECIES rows, so a record filed under a
 *     subspecies read "unrated" — 棕背伯勞 and 小水鴨, 23 records.
 *   - The law protects 臺灣蛇蜥 under a name TaiCOL has moved to a row that is
 *     not in Taiwan, and the TaiCOL import overwrites any hand edit.
 *   - TaiCOL keeps duplicates; the unprotected row of a class I cockatoo
 *     published exactly.
 *
 * And 0012's re-blur could itself loosen a record: it compared a taxon's old
 * rating with its new one, then re-derived every record of it from scratch,
 * including records it had deliberately left stricter than the rating.
 *
 * Every test here builds its own taxa inside a rolled-back transaction, so it
 * asserts the rule rather than whatever TaiCOL happens to say this month —
 * except the ones about the committed floors, which are about exactly that.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback, insertReport } from "./helpers.mjs";
import { readOverrides, parseOverrides } from "../../../scripts/taxa-overrides.ts";

after(() => sql.end());

const RANK = { exact: 0, coarse_10km: 1, coarse_50km: 2, suppressed: 3 };

let seq = 0;
/** A TaiCOL-shaped id nothing real will ever have. */
const uid = () => `test-sw-${process.pid}-${Date.now()}-${seq++}`;
/** A binomial no real taxon shares, so sibling rules see only this test's rows. */
const binomial = () => `Testudofixtura e${process.pid}x${Date.now()}x${seq++}`;

async function taxon(
  tx,
  {
    name = binomial(),
    rank = "Species",
    parent = null,
    sensitivity = null,
    protectedStatus = null,
    status = "accepted",
  } = {},
) {
  const [t] = await tx`
    insert into taxa (taicol_id, parent_taicol_id, scientific_name, rank,
                      is_in_taiwan, sensitivity, protected_status, taxon_status)
    values (${uid()}, ${parent}, ${name}, ${rank}, true,
            ${sensitivity}, ${protectedStatus}, ${status})
    returning id, taicol_id, scientific_name`;
  return t;
}

const precisionOf = async (tx, id) =>
  (await tx`select location_precision from reports where id = ${id}`)[0]
    .location_precision;

describe("a subspecies is blurred at least as hard as its species", () => {
  test("it takes the species' rating when it has none of its own", async () => {
    // 棕背伯勞: TaiCOL rates Lanius schach 輕度 and leaves L. s. schach, the
    // row holding every record, blank.
    await inRollback(async (tx) => {
      const sp = await taxon(tx, { sensitivity: "輕度" });
      const ssp = await taxon(tx, {
        name: `${sp.scientific_name} minor`,
        rank: "Subspecies",
        parent: sp.taicol_id,
      });
      const r = await insertReport(tx, { taxonId: ssp.id });
      assert.equal(r.location_precision, "coarse_10km",
        "a subspecies of a rated species was published to the metre");
    });
  });

  test("and keeps its own rating when that is the stricter one", async () => {
    await inRollback(async (tx) => {
      const sp = await taxon(tx, { sensitivity: "輕度" });
      const ssp = await taxon(tx, {
        rank: "Subspecies",
        parent: sp.taicol_id,
        sensitivity: "重度",
      });
      const r = await insertReport(tx, { taxonId: ssp.id });
      assert.equal(r.location_precision, "coarse_50km");
    });
  });

  test("a variety under a subspecies climbs all the way to the species", async () => {
    // 44 infraspecific rows in TaiCOL hang off another infraspecific row, so
    // looking one row up is not enough.
    await inRollback(async (tx) => {
      const sp = await taxon(tx, { sensitivity: "重度" });
      const ssp = await taxon(tx, { rank: "Subspecies", parent: sp.taicol_id });
      const v = await taxon(tx, { rank: "Variety", parent: ssp.taicol_id });
      const r = await insertReport(tx, { taxonId: v.id });
      assert.equal(r.location_precision, "coarse_50km");
    });
  });

  test("a species is not blurred by a subspecies under it", async () => {
    // The rule runs one way. 豹貓 is class II and its Taiwan subspecies 石虎
    // class I; that does not make every leopard cat in Asia class I.
    await inRollback(async (tx) => {
      const sp = await taxon(tx);
      await taxon(tx, { rank: "Subspecies", parent: sp.taicol_id, protectedStatus: "I" });
      const r = await insertReport(tx, { taxonId: sp.id });
      assert.equal(r.location_precision, "exact");
    });
  });
});

describe("a species rated after its subspecies' records were published", () => {
  test("re-blurs the subspecies' records too", async () => {
    // 0012 re-derived only the records of the row whose rating moved. TaiCOL's
    // ratings arrive on species rows and the records sit on subspecies rows,
    // so the next import would have rated 棕背伯勞 and blurred none of it.
    await inRollback(async (tx) => {
      const sp = await taxon(tx);
      const ssp = await taxon(tx, { rank: "Subspecies", parent: sp.taicol_id });
      const r = await insertReport(tx, { taxonId: ssp.id });
      assert.equal(r.location_precision, "exact", "fixture precondition");

      await tx`update taxa set sensitivity = '輕度' where id = ${sp.id}`;

      assert.equal(await precisionOf(tx, r.id), "coarse_10km");
    });
  });
});

describe("a floor", () => {
  test("blurs a taxon TaiCOL leaves unrated, including records already published", async () => {
    await inRollback(async (tx) => {
      const t = await taxon(tx);
      const before = await insertReport(tx, { taxonId: t.id });
      assert.equal(before.location_precision, "exact", "fixture precondition");

      await tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
               values (${t.taicol_id}, 'coarse_10km', 'test')`;

      assert.equal(await precisionOf(tx, before.id), "coarse_10km",
        "adding a floor must re-blur what is already on the map");
      const next = await insertReport(tx, { taxonId: t.id });
      assert.equal(next.location_precision, "coarse_10km");
    });
  });

  test("on a species reaches the records of its subspecies", async () => {
    await inRollback(async (tx) => {
      const sp = await taxon(tx);
      const ssp = await taxon(tx, { rank: "Subspecies", parent: sp.taicol_id });
      const r = await insertReport(tx, { taxonId: ssp.id });
      await tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
               values (${sp.taicol_id}, 'coarse_50km', 'test')`;
      assert.equal(await precisionOf(tx, r.id), "coarse_50km");
    });
  });

  test("survives an import that clears the taxon's rating", async () => {
    // What scripts/import-taicol.ts does to a hand edit on every run. The new
    // record is the point: an existing one would stay blurred anyway, by 0012's
    // refusal to loosen, and that would prove nothing about the floor.
    await inRollback(async (tx) => {
      const t = await taxon(tx, { protectedStatus: "II" });
      await tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
               values (${t.taicol_id}, 'coarse_10km', 'test')`;
      await tx`update taxa set protected_status = null, sensitivity = null
                where id = ${t.id}`;
      const r = await insertReport(tx, { taxonId: t.id });
      assert.equal(r.location_precision, "coarse_10km");
    });
  });

  test("cannot say 'exact'", async () => {
    await inRollback(async (tx) => {
      await assert.rejects(
        () => tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
                 values (${uid()}, 'exact', 'test')`,
        /violates check constraint/,
      );
    });
  });

  test("lowered or removed, does not un-blur what it blurred", async () => {
    // Publishing a withheld location is a decision (0012). Editing a list
    // is not that decision.
    await inRollback(async (tx) => {
      const t = await taxon(tx);
      await tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
               values (${t.taicol_id}, 'coarse_50km', 'test')`;
      const r = await insertReport(tx, { taxonId: t.id });
      assert.equal(r.location_precision, "coarse_50km");

      await tx`update taxon_precision_floors set min_precision = 'coarse_10km'
                where taicol_id = ${t.taicol_id}`;
      assert.equal(await precisionOf(tx, r.id), "coarse_50km");

      await tx`delete from taxon_precision_floors where taicol_id = ${t.taicol_id}`;
      assert.equal(await precisionOf(tx, r.id), "coarse_50km");
    });
  });
});

describe("re-deriving never loosens", () => {
  test("a record kept stricter than its taxon stays so when the taxon tightens again", async () => {
    // The hole in 0012. A 重度 species puts its records at 50 km. TaiCOL
    // withdraws the rating: 0012 rightly leaves them at 50 km. Later the
    // species is listed class III, which is "stricter than unrated", so 0012
    // re-derived every record from scratch — and took them from 50 km to 10.
    await inRollback(async (tx) => {
      const t = await taxon(tx, { sensitivity: "重度" });
      const r = await insertReport(tx, { taxonId: t.id });
      assert.equal(r.location_precision, "coarse_50km");

      await tx`update taxa set sensitivity = null where id = ${t.id}`;
      assert.equal(await precisionOf(tx, r.id), "coarse_50km", "0012's ratchet");

      await tx`update taxa set protected_status = 'III' where id = ${t.id}`;
      assert.equal(await precisionOf(tx, r.id), "coarse_50km",
        "a tightening rating re-derived a record down to a looser blur");
    });
  });
});

describe("the committed floors", () => {
  const floors = readOverrides();

  test("the file is well-formed and each line gives a reason", () => {
    assert.ok(floors.length >= 3, "expected the floors this migration shipped with");
    for (const f of floors) assert.ok(f.reason.length > 20, `${f.taicol_id}: say why`);
  });

  test("the parser refuses what the table would refuse", () => {
    const head = "taicol_id,min_precision,reason\n";
    assert.throws(() => parseOverrides(`${head}t0028707,exact,"x"`), /min_precision/);
    assert.throws(() => parseOverrides(`${head}t0028707,coarse_10km,`), /reason/);
    assert.throws(() => parseOverrides(`${head}28707,coarse_10km,"x"`), /TaiCOL/);
    assert.throws(
      () => parseOverrides(`${head}t0028707,coarse_10km,"x"\nt0028707,coarse_50km,"y"`),
      /twice/,
    );
  });

  test("every line is in force in the database, at least as strict", async () => {
    const rows = await sql`select taicol_id, min_precision from taxon_precision_floors`;
    const have = new Map(rows.map((r) => [r.taicol_id, r.min_precision]));
    for (const f of floors) {
      assert.ok(have.has(f.taicol_id), `${f.taicol_id} is in the file but not the database`);
      assert.ok(
        RANK[have.get(f.taicol_id)] >= RANK[f.min_precision],
        `${f.taicol_id} is looser in the database than in the file`,
      );
    }
  });

  for (const [taicol, what] of [
    ["t0028707", "臺灣蛇蜥 under TaiCOL's current name"],
    ["t0124331", "臺灣蛇蜥's deleted duplicate row"],
    ["t0125438", "the unprotected row of a class I cockatoo"],
  ]) {
    test(`a report of ${what} is blurred`, async () => {
      const [t] = await sql`select id from taxa where taicol_id = ${taicol}`;
      // Asserted, not skipped: supabase/seed-test.sql carries these rows so CI
      // tests the real ids and not a stand-in.
      assert.ok(t, `${taicol} should be in taxa (local copy or the CI fixture)`);
      await inRollback(async (tx) => {
        const r = await insertReport(tx, { taxonId: t.id });
        assert.equal(r.location_precision, "coarse_10km");
      });
    });
  }
});

describe("the migration only tightens", () => {
  /** 0011's rule, restated: the record's own taxon, its override, and 10 km for no taxon. */
  const OLD_RULE = `
    case
      when precision_rank(coalesce(r.precision_override, 'exact'))
           > precision_rank(case when r.taxon_id is null then 'coarse_10km'
                                 else precision_from_taxon(t.sensitivity, t.protected_status) end)
      then r.precision_override
      else case when r.taxon_id is null then 'coarse_10km'
                else precision_from_taxon(t.sensitivity, t.protected_status) end
    end`;

  test("for no record are the new rules looser than the old one", async () => {
    const [row] = await sql`
      select count(*)::int as n
        from reports r left join taxa t on t.id = r.taxon_id
       where precision_rank(report_precision(r.taxon_id, r.precision_override))
             < precision_rank(${sql.unsafe(OLD_RULE)})`;
    assert.equal(row.n, 0);
  });

  test("no record is published looser than the rules now say", async () => {
    // The state after 0014's one-time re-derive. Nothing can reach it later
    // either: the trigger writes exactly this on insert and update, and the
    // re-blur triggers only ever raise it.
    const [row] = await sql`
      select count(*)::int as n from reports r
       where precision_rank(r.location_precision)
             < precision_rank(report_precision(r.taxon_id, r.precision_override))`;
    assert.equal(row.n, 0);
  });

  test("replaying the one-time re-derive over every record: nothing goes down", async () => {
    // Before 0014, every record sat at what the old rule gave it. Put them all
    // back there, snapshot, run the migration's own re-derive, snapshot again.
    // Two fixture records make it non-vacuous on any database, including CI's:
    // one the new rules tighten, and one already stricter than any rule, which
    // a re-derive without the guard would loosen.
    await inRollback(async (tx) => {
      const sp = await taxon(tx, { sensitivity: "輕度" });
      const ssp = await taxon(tx, { rank: "Subspecies", parent: sp.taicol_id });
      const tightens = await insertReport(tx, { taxonId: ssp.id });
      const open = await taxon(tx);
      const kept = await insertReport(tx, { taxonId: open.id });

      await tx`
        update reports r
           set location_precision = ${tx.unsafe(OLD_RULE)}
          from reports r2 left join taxa t on t.id = r2.taxon_id
         where r2.id = r.id`;
      // Stricter than every rule that applies to it: a person's decision.
      await tx`update reports set location_precision = 'coarse_50km' where id = ${kept.id}`;

      const snapshot = async () =>
        new Map(
          (await tx`select id, location_precision from reports`).map((r) => [
            r.id,
            r.location_precision,
          ]),
        );
      const before = await snapshot();
      assert.equal(before.get(tightens.id), "exact", "fixture precondition");

      await tx`select tighten_reports(null)`;
      const after_ = await snapshot();

      const down = [...before].filter(([id, p]) => RANK[after_.get(id)] < RANK[p]);
      assert.deepEqual(down, [], "a record's blur went down");
      assert.equal(after_.get(tightens.id), "coarse_10km", "the subspecies record tightened");
      assert.equal(after_.get(kept.id), "coarse_50km", "the guard kept a stricter record");
    });
  });

  test("the migration runs that re-derive, and not an unguarded one", () => {
    const file = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "supabase", "migrations",
           "0014_stricter_wins_blur.sql"),
      "utf8",
    );
    const code = file
      .split("\n")
      .filter((l) => !/^\s*(--|\*|\/\*\*)/.test(l))
      .join("\n");
    assert.match(code, /^select tighten_reports\(null\);$/m);
    // A bare `update reports set location = location` re-derives every record
    // from scratch, which loosens any record stricter than its rules.
    assert.doesNotMatch(code, /update reports\s+set location = location\s*;/);
  });
});
