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
import {
  readOverrides,
  parseOverrides,
  RETIRED_TWINS_SQL,
  retiredTwinsSql,
} from "../../../scripts/taxa-overrides.ts";

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
    successor = null,
  } = {},
) {
  const [t] = await tx`
    insert into taxa (taicol_id, parent_taicol_id, scientific_name, rank,
                      is_in_taiwan, sensitivity, protected_status, taxon_status,
                      new_taicol_id)
    values (${uid()}, ${parent}, ${name}, ${rank}, true,
            ${sensitivity}, ${protectedStatus}, ${status}, ${successor})
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

  for (const [taicol, what, expected] of [
    ["t0028707", "臺灣蛇蜥 under TaiCOL's current name", "coarse_10km"],
    ["t0124331", "臺灣蛇蜥's deleted duplicate row", "coarse_10km"],
    ["t0125438", "the unprotected row of a class I cockatoo", "coarse_10km"],
    ["t0072234", "黃頸蝠 by the name in use (TaiCOL rates only its retired twin)", "coarse_50km"],
    ["t0102470", "Dorcus hopei (its only Taiwan form is protected)", "coarse_10km"],
  ]) {
    test(`a report of ${what} is blurred`, async () => {
      const [t] = await sql`select id from taxa where taicol_id = ${taicol}`;
      // Asserted, not skipped: supabase/seed-test.sql carries these rows so CI
      // tests the real ids and not a stand-in.
      assert.ok(t, `${taicol} should be in taxa (local copy or the CI fixture)`);
      await inRollback(async (tx) => {
        const r = await insertReport(tx, { taxonId: t.id });
        assert.equal(r.location_precision, expected);
      });
    });
  }
});

describe("a rating TaiCOL left on a retired name", () => {
  // The picker, the directory and the report form offer accepted names only.
  // A rating that stays on the deleted twin therefore protects nobody: every
  // person who names 黃頸蝠 picks t0072234, which TaiCOL leaves unrated, while
  // t0102479, rated 縣市, is never offered. 36 orchids and other plants were
  // the same. Each needs a floor on the name in use, and a TaiCOL refresh can
  // add more, so the rule is a query and not only a list.
  const pairs = () => sql.unsafe(`select * from (${RETIRED_TWINS_SQL}) x`);

  test("the query sees a real pair, so the next assertion is not vacuous", async () => {
    // supabase/seed-test.sql carries 黃頸蝠's two rows for exactly this.
    const found = (await pairs()).filter(
      (p) => p.taicol_id === "t0072234" && p.retired_taicol_id === "t0102479",
    );
    assert.equal(found.length, 1, "黃頸蝠's retired twin was not found");
    assert.equal(found[0].retired_precision, "coarse_50km", "fixture precondition");
  });

  test("no name in use is blurred less than its retired twin", async () => {
    const looser = (await pairs())
      .filter((p) => p.looser)
      .map((p) => `${p.taicol_id} ${p.scientific_name} (${p.precision}) < ` +
                  `${p.retired_taicol_id} (${p.retired_precision})`);
    assert.deepEqual(looser, [],
      "add a floor for each to scripts/taxa-overrides.csv and apply it, or the " +
      "owner's decision against one to NO_FLOOR in scripts/taxa-overrides.ts " +
      "(npx tsx scripts/retired-twins.ts says what each is)");
  });

  test("and the query would catch one", async () => {
    // Put the defect back, on rows of our own: an unrated accepted name beside
    // a rated retired one.
    await inRollback(async (tx) => {
      const name = binomial();
      const used = await taxon(tx, { name });
      await taxon(tx, { name, status: "deleted", sensitivity: "重度" });
      const [row] = await tx.unsafe(
        `select * from (${RETIRED_TWINS_SQL}) x where taicol_id = $1`,
        [used.taicol_id],
      );
      assert.ok(row?.looser, "an unfloored twin went unnoticed");
    });
  });

  const twinsOf = (tx, taicolId) =>
    tx.unsafe(`select * from (${RETIRED_TWINS_SQL}) x where taicol_id = $1`, [taicolId]);

  test("and one TaiCOL renamed, which shares no name with the row in use", async () => {
    // 鉛色水蛇 Enhydris plumbea, rated 座標不開放 on its deleted rows, became
    // 韋氏水蛇 Hypsiscopus wettsteini, which is only protected class III.
    // Neither name matches the other; TaiCOL's new_taxon_id is the only link,
    // and the check matched names only while 29 records went from hidden to
    // 10 km.
    await inRollback(async (tx) => {
      const used = await taxon(tx, { protectedStatus: "III" });
      const retired = await taxon(tx, {
        status: "deleted",
        sensitivity: "座標不開放",
        successor: used.taicol_id,
      });
      const rows = await twinsOf(tx, used.taicol_id);
      assert.equal(rows.length, 1, "the renamed row's successor was not found");
      assert.equal(rows[0].retired_taicol_id, retired.taicol_id);
      assert.equal(rows[0].by_successor, true);
      assert.equal(rows[0].precision, "coarse_10km", "fixture precondition");
      assert.equal(rows[0].retired_precision, "suppressed", "fixture precondition");
      assert.equal(rows[0].looser, true, "an unfloored rename went unnoticed");

      // And the floor 0032 put on 韋氏水蛇 is what the check then accepts.
      await tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
               values (${used.taicol_id}, 'suppressed', 'test')`;
      const [held] = await twinsOf(tx, used.taicol_id);
      assert.equal(held.looser, false);
    });
  });

  test("and a name TaiCOL moved twice, through a row it retired later", async () => {
    // A rated row points at one TaiCOL has since retired too, which points at
    // the row in use. The rating sits two hops away from the name people pick.
    await inRollback(async (tx) => {
      const used = await taxon(tx);
      const between = await taxon(tx, { status: "deleted", successor: used.taicol_id });
      const first = await taxon(tx, {
        status: "deleted",
        sensitivity: "重度",
        successor: between.taicol_id,
      });
      const rows = await twinsOf(tx, used.taicol_id);
      const found = rows.find((r) => r.retired_taicol_id === first.taicol_id);
      assert.ok(found, "the first name's rating did not reach the row in use");
      assert.equal(found.looser, true);
    });
  });

  test("the query follows a real rename by TaiCOL's id, so that path is not vacuous either", async () => {
    // 鉛色水蛇's two deleted rows name 韋氏水蛇 as their successor, and 0032's
    // floor holds the snake hidden. CI's fixture has the floor, which is a
    // migration, but not the rows, so they are added here and rolled back. A
    // database that has the rows must have TaiCOL's pointers on them too: with
    // the column empty the check matches names only and misses every rename.
    await inRollback(async (tx) => {
      await tx`
        insert into taxa (taicol_id, scientific_name, common_name_zh, rank, kingdom,
                          is_in_taiwan, taxon_status, protected_status)
        values ('t0029845', 'Hypsiscopus wettsteini', '韋氏水蛇', 'Species', 'Animalia',
                true, 'accepted', 'III')
        on conflict (taicol_id) do nothing`;
      await tx`
        insert into taxa (taicol_id, scientific_name, common_name_zh, rank, kingdom,
                          is_in_taiwan, taxon_status, sensitivity, new_taicol_id)
        select id, 'Enhydris plumbea', '鉛色水蛇', 'Species', 'Animalia',
               true, 'deleted', '座標不開放', 't0029845'
          from unnest(array['t0101462', 't0105945']) id
        on conflict (taicol_id) do nothing`;
      const pointers = await tx`
        select new_taicol_id from taxa
         where taicol_id in ('t0101462', 't0105945') order by taicol_id`;
      assert.deepEqual(pointers.map((p) => p.new_taicol_id), ["t0029845", "t0029845"],
        "the retired snake rows carry no successor id: run scripts/taicol-successors-sql.ts");

      const rows = (await twinsOf(tx, "t0029845"))
        .filter((r) => ["t0101462", "t0105945"].includes(r.retired_taicol_id));
      assert.equal(rows.length, 2, "the rename was not found by TaiCOL's id");
      for (const r of rows) {
        assert.equal(r.by_successor, true);
        assert.equal(r.retired_precision, "suppressed", "fixture precondition");
        assert.equal(r.precision, "suppressed", "0032's floor on 韋氏水蛇 is not in force");
        assert.equal(r.looser, false);
      }
    });
  });

  test("but not a retired genus TaiCOL points at a species", async () => {
    // 厚距花屬 Pachycentria points at 臺灣厚距花 Medinilla taiwaniana. A genus
    // carries no rating of its own; the 10 km a name above the species can get
    // (0033) is about records named that vaguely, not about the species.
    await inRollback(async (tx) => {
      const used = await taxon(tx);
      await taxon(tx, { name: "Testudofixtura", rank: "Genus", status: "deleted",
                        successor: used.taicol_id });
      assert.equal((await twinsOf(tx, used.taicol_id)).length, 0, "a retired genus was paired");
    });
  });

  test("and passes over a pair the owner decided needs no floor, and only that pair", async () => {
    // NO_FLOOR in taxa-overrides.ts: a decision on one retired row must not
    // hide the next rated row TaiCOL moves onto the same name.
    await inRollback(async (tx) => {
      const used = await taxon(tx);
      const decided = await taxon(tx, { status: "deleted", sensitivity: "輕度",
                                        successor: used.taicol_id });
      const other = await taxon(tx, { status: "deleted", sensitivity: "輕度",
                                      successor: used.taicol_id });
      const query = retiredTwinsSql(undefined, [
        { taicol_id: used.taicol_id, retired_taicol_id: decided.taicol_id, reason: "test" },
      ]);
      const rows = await tx.unsafe(`select * from (${query}) x where taicol_id = $1`,
                                   [used.taicol_id]);
      const by = new Map(rows.map((r) => [r.retired_taicol_id, r]));
      assert.equal(by.get(decided.taicol_id)?.looser, false, "a decided pair still fails the check");
      assert.equal(by.get(other.taicol_id)?.looser, true,
        "the decision hid another retired row on the same name");
    });
  });

  test("and lists a pair linked both ways once", async () => {
    // 黃頸蝠's retired row shares its name with the row in use and may also
    // point at it; preflight counts the pairs, so each is one row.
    await inRollback(async (tx) => {
      const name = binomial();
      const used = await taxon(tx, { name });
      await taxon(tx, { name, status: "deleted", sensitivity: "縣市", successor: used.taicol_id });
      const rows = await twinsOf(tx, used.taicol_id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].by_successor, true);
    });
  });
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

  test("replaying the one-time re-derive: nothing goes down", async () => {
    // Before 0014, every record sat at what the old rule gave it. The first
    // test above shows, read-only and for every record, that the new rules are
    // never looser than that; what is left to show is that the re-derive
    // itself never lowers a record, including one that is stricter than every
    // rule. So two fixture records are put back at the old rule — one the new
    // rules tighten, and one a person held at 50 km, which a re-derive without
    // the guard would loosen — and the migration's own call runs over the
    // whole table, with every record's precision compared before and after.
    //
    // Only the fixtures are rewritten. Rewriting every record put a row lock
    // on all 46k of them for as long as the test ran, which stalled every
    // other test and person updating a report on the shared database.
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
         where r2.id = r.id
           and r.id in (${tightens.id}, ${kept.id})`;
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
