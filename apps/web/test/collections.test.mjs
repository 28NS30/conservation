/**
 * The three collections — roadkill, wildlife, invasive — and the one column
 * of the public view they need.
 *
 * 0016 appends `is_invasive` to `reports_public`. That view is the privacy
 * boundary: the public role reads it and nothing else, and it is where a
 * record of a species rated 座標不開放 is kept out. So the first half of this
 * file is about what the migration must NOT have changed — the columns, the
 * rows, the grants — and the second about what the new column says, since a
 * record's place in the invasive collection is decided by it alone.
 *
 * The last part counts the collections on whatever database it runs against
 * and prints them, so a run on the full local copy reports the numbers.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { COLLECTION_KEYS, selectionFor } from "@conservation/shared";
import { sql, inRollback, insertReport } from "./helpers.mjs";

after(() => sql.end());

/**
 * The public view's columns, in order. 0010's seventeen and 0016's one.
 *
 * Exact, not "includes": a column added here is a column published to every
 * visitor, and that should take a deliberate edit to this list, not slip in
 * with a `select *` or a careless `create or replace`.
 */
const PUBLIC_COLUMNS = [
  "id",
  "category",
  "geom_3857",
  "location_public",
  "location_precision",
  "is_obscured",
  "observed_at",
  "notes",
  "taxon_id",
  "taxon_source",
  "verbatim_name",
  "ai_confidence",
  "source",
  "license",
  "rights_holder",
  "created_at",
  "location_accuracy_m",
  "is_invasive",
];

let seq = 0;
/** A taxon of our own, so nothing depends on which names a fixture carries. */
async function taxon(
  tx,
  { invasive = false, kingdom = "Animalia", status = "accepted", sensitivity = null } = {},
) {
  const [t] = await tx`
    insert into taxa (taicol_id, scientific_name, rank, kingdom, is_in_taiwan,
                      taxon_status, is_invasive, alien_type, sensitivity)
    values (${`test-col-${process.pid}-${Date.now()}-${seq++}`},
            ${`Testudofixtura col${process.pid}x${seq}`}, 'Species', ${kingdom}, true,
            ${status}, ${invasive}, ${invasive ? "invasive" : "native"}, ${sensitivity})
    returning id`;
  return t.id;
}

const publicRow = async (tx, id) => {
  const [row] = await tx`
    select is_invasive, location_precision from reports_public where id = ${id}::uuid`;
  return row;
};

describe("reports_public after 0016", () => {
  test("carries exactly these columns, in this order", async () => {
    const cols = await sql`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'reports_public'
       order by ordinal_position`;
    assert.deepEqual(
      cols.map((c) => c.column_name),
      PUBLIC_COLUMNS,
    );
  });

  test("web_anon is still denied on reports", async () => {
    await assert.rejects(
      () =>
        sql.begin(async (tx) => {
          await tx`set local role web_anon`;
          await tx`select taxon_id from reports limit 1`;
        }),
      (err) => /permission denied/i.test(err.message),
      "web_anon must not be able to read the reports base table",
    );
  });

  test("web_anon holds SELECT on the view and nothing else", async () => {
    // `create or replace` keeps a view's privileges; this is the check that it
    // did, and that nothing was granted beside it.
    const grants = await sql`
      select privilege_type from information_schema.role_table_grants
       where grantee = 'web_anon' and table_name = 'reports_public'`;
    assert.deepEqual(
      grants.map((g) => g.privilege_type),
      ["SELECT"],
    );
    const onBase = await sql`
      select privilege_type from information_schema.role_table_grants
       where grantee = 'web_anon' and table_name = 'reports'`;
    assert.deepEqual(
      onBase.map((g) => g.privilege_type),
      [],
      "web_anon has been granted something on reports",
    );
  });

  test("web_anon can read the new column", async () => {
    const n = await sql.begin(async (tx) => {
      await tx`set local role web_anon`;
      const [row] = await tx`
        select count(*) filter (where is_invasive)::int as n from reports_public`;
      return row.n;
    });
    assert.ok(Number.isInteger(n));
  });

  test("the same rows: published, and not suppressed", async () => {
    // FROM and WHERE are 0010's. A scalar column cannot add or remove a row,
    // and this is what would notice if a later edit made it try.
    const [row] = await sql`
      select (select count(*) from reports_public)::int as public,
             (select count(*) from reports
               where status = 'published'
                 and location_precision <> 'suppressed')::int as eligible`;
    assert.equal(row.public, row.eligible);
  });

  test("a withheld taxon stays absent, even when it is an invasive animal", async () => {
    // The one combination that could tempt a collection to reach past the
    // view: an invasive species rated 座標不開放. Its records must be in no
    // collection, and its public record count must stay 0.
    await inRollback(async (tx) => {
      const hidden = await taxon(tx, { invasive: true, sensitivity: "座標不開放" });
      const r = await insertReport(tx, { taxonId: hidden, category: "roadkill" });
      assert.equal(r.location_precision, "suppressed", "fixture: the taxon is withheld");

      assert.equal(await publicRow(tx, r.id), undefined, "a withheld record reached the view");
      const [{ n }] = await tx`
        select count(*)::int as n from reports_public
         where taxon_id = ${hidden} and is_invasive`;
      assert.equal(n, 0, "the invasive collection counted a withheld record");
      const [stats] = await tx`
        select report_count from species_report_stats where taxon_id = ${hidden}`;
      assert.equal(stats, undefined, "the species list would show a count for it");
    });
  });

  test("the column does not move a blur", async () => {
    // It reads the species; the trigger that sets precision does not read it.
    // A protected invasive animal (the cockatoos are class I) stays blurred.
    await inRollback(async (tx) => {
      const rated = await taxon(tx, { invasive: true, sensitivity: "輕度" });
      const r = await insertReport(tx, { taxonId: rated, category: "sighting" });
      const row = await publicRow(tx, r.id);
      assert.equal(row.is_invasive, true);
      assert.equal(row.location_precision, "coarse_10km");
    });
  });
});

describe("what is_invasive says", () => {
  // The team's defaults (plan §7): TaiCOL's invasive tag, animals only,
  // accepted names; any category, dead ones included; and a record with no
  // species is invasive only when it was filed as invasive.
  for (const [what, fixture, category, expected] of [
    ["an invasive animal found dead", { invasive: true }, "roadkill", true],
    ["an invasive animal seen alive, filed as a sighting", { invasive: true }, "sighting", true],
    ["a native animal filed on the invasive page", { invasive: false }, "invasive", false],
    ["an invasive plant", { invasive: true, kingdom: "Plantae" }, "sighting", false],
    ["an invasive animal under a name TaiCOL retired", { invasive: true, status: "deleted" }, "roadkill", false],
  ])
    test(`${what}: ${expected}`, async () => {
      await inRollback(async (tx) => {
        const id = await taxon(tx, fixture);
        const r = await insertReport(tx, { taxonId: id, category });
        assert.equal((await publicRow(tx, r.id)).is_invasive, expected);
      });
    });

  test("no species, filed as invasive: true; filed as anything else: false", async () => {
    await inRollback(async (tx) => {
      const filed = await insertReport(tx, { taxonId: null, category: "invasive" });
      const other = await insertReport(tx, { taxonId: null, category: "sighting" });
      assert.equal((await publicRow(tx, filed.id)).is_invasive, true);
      assert.equal((await publicRow(tx, other.id)).is_invasive, false);
    });
  });

  test("never null, on any public record", async () => {
    // A null would drop a record from `not invasiveOnly or is_invasive` and
    // from its negation alike: in no collection's count and no one's list.
    const [row] = await sql`
      select count(*)::int as n from reports_public where is_invasive is null`;
    assert.equal(row.n, 0);
  });
});

describe("collection counts on this database", () => {
  const count = async (f) => {
    const { categories, invasiveOnly } = selectionFor(f);
    const [row] = await sql`
      select count(*)::int as n from reports_public rp
       where (${categories}::text[] is null or rp.category = any(${categories}))
         and (not ${invasiveOnly}::boolean or rp.is_invasive)`;
    return row.n;
  };

  test("roadkill and wildlife together are every public record, once each", async (t) => {
    const all = await count({});
    const roadkill = await count({ collection: "roadkill" });
    const wildlife = await count({ collection: "wildlife" });
    const invasive = await count({ collection: "invasive" });
    const alive = await count({ collection: "invasive", condition: "alive" });
    const dead = await count({ collection: "invasive", condition: "dead" });
    t.diagnostic(
      `all ${all} · roadkill ${roadkill} · wildlife ${wildlife} · invasive ${invasive} ` +
        `(alive ${alive}, dead or injured ${dead})`,
    );
    assert.equal(roadkill + wildlife, all, "a record is in neither, or in both");
    assert.equal(alive + dead, invasive, "the alive/dead split loses or doubles records");
    assert.ok(invasive <= all);
  });

  test("every collection a page names is one the tiles can draw", () => {
    assert.deepEqual([...COLLECTION_KEYS].sort(), ["invasive", "roadkill", "wildlife"]);
  });

  test("the invasive species list counts only records in the collection", async (t) => {
    // The hub lists accepted invasive animals with their record counts. Each
    // of those records has to be in the collection, or the list and the
    // collection's own total would describe different sets.
    const [row] = await sql`
      select coalesce(sum(s.report_count), 0)::int as listed,
             (select count(*)::int from reports_public where is_invasive and taxon_id is not null) as named
        from taxa t
        join species_report_stats s on s.taxon_id = t.id
       where t.taxon_status is not distinct from 'accepted' and t.is_in_taiwan
         and t.rank in ('Species','Subspecies')
         and t.kingdom = 'Animalia'
         and t.is_invasive`;
    t.diagnostic(`listed ${row.listed} of ${row.named} named invasive records`);
    assert.ok(row.listed <= row.named, "the list counts records outside the collection");
  });
});
