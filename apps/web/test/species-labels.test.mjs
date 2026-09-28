/**
 * Species labels that were wrong, and records on names that do not apply in
 * Taiwan. The team's request 13 ("make sure the species classifications are
 * correct"); each fix is from the roadmap's species list, checked against
 * TaiCOL by two researchers.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, BASE_URL } from "./helpers.mjs";
import { speciesNames } from "../lib/speciesNames.ts";
import { SPECIES_NOTES, speciesNotes } from "../lib/speciesNotes.ts";

after(() => sql.end());

const MIGRATION = readFileSync(
  join(import.meta.dirname, "../../../supabase/migrations/0022_records_to_taiwan_names.sql"),
  "utf8",
);
const MOVES = [
  ["t0032116", "t0105762"],
  ["t0124472", "t0028707"],
  ["t0105665", "t0038839"],
  ["t0062784", "t0105743"],
];

async function server() {
  return (await fetch(BASE_URL).catch(() => null)) !== null;
}

describe("curated labels", () => {
  test("the Indian python is not called by Taiwan's python's name", () => {
    // TaiCOL gives 緬甸蟒 to both; the one not in Taiwan becomes 亞洲岩蟒.
    const n = speciesNames(
      { taicolId: "t0102070", scientificName: "Python molurus", commonNameZh: "緬甸蟒", commonNameEn: "Indian Python" },
      "zh-TW",
    );
    assert.equal(n.primary.text, "亞洲岩蟒");
    const taiwan = speciesNames(
      { taicolId: "t0037533", scientificName: "Python bivittatus", commonNameZh: "緬甸蟒" },
      "zh-TW",
    );
    assert.equal(taiwan.primary.text, "緬甸蟒", "Taiwan's python keeps its name");
  });

  test("the birds introduced on the main island are marked, and only they", () => {
    const introduced = Object.entries(SPECIES_NOTES)
      .filter(([, e]) => e.notes?.includes("introducedMainIsland"))
      .map(([id]) => id)
      .sort();
    assert.deepEqual(introduced, ["t0029282", "t0064818", "t0084390", "t0085493", "t0097085", "t0097785"]);
    assert.deepEqual(speciesNotes("t0033457"), [], "an ordinary taxon has no note");
  });

  test("every curated id is a real, accepted taxon where the database has it", async () => {
    const ids = Object.keys(SPECIES_NOTES);
    const rows = await sql`select taicol_id, taxon_status from taxa where taicol_id = any(${ids})`;
    for (const r of rows) assert.equal(r.taxon_status, "accepted", r.taicol_id);
  });
});

describe("migration 0022 moves records without loosening any", () => {
  test("each move stamps the record's current blur before the trigger recomputes it", () => {
    const code = MIGRATION.replace(/--.*$/gm, "");
    assert.match(code, /stricter_precision\(r\.precision_override, r\.location_precision\)/);
    assert.match(code, /when r\.location_precision = 'exact' then r\.precision_override/);
    assert.match(code, /and r\.source = 'gbif'/);
    for (const [from, to] of MOVES) assert.match(code, new RegExp(`\\('${from}', '${to}'\\)`));
  });

  test("run against this database: moved, none looser, nothing else touched, and a second run is a no-op", async () => {
    const body = MIGRATION.replace(/^set local lock_timeout.*$/m, "");
    const marker = Symbol("rollback");
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`create temp table _snap on commit drop as
          select id, taxon_id, location_precision, st_astext(location_public::geometry) as pub from reports`);
        await tx.unsafe(body);
        const [c] = await tx`
          select
            count(*) filter (where r.taxon_id is distinct from s.taxon_id)::int as moved,
            count(*) filter (where precision_rank(r.location_precision) < precision_rank(s.location_precision))::int as looser,
            count(*) filter (where r.taxon_id is not distinct from s.taxon_id
                               and (r.location_precision is distinct from s.location_precision
                                    or st_astext(r.location_public::geometry) is distinct from s.pub))::int as other
            from reports r join _snap s using (id)`;
        assert.equal(c.looser, 0, "a moved record came out less blurred");
        assert.equal(c.other, 0, "a record that was not moved changed");
        const [left] = await tx`
          select count(*)::int as n from reports r join taxa t on t.id = r.taxon_id
           where r.source = 'gbif' and t.taicol_id = any(${MOVES.map((m) => m[0])})`;
        assert.equal(left.n, 0, "records remain on a name that does not apply in Taiwan");
        const again = await tx.unsafe(body);
        assert.equal(again.count, 0, "a second run moved something");
        throw marker;
      });
    } catch (e) {
      if (e !== marker) throw e;
    }
  });
});

describe("the species page", () => {
  test("says a species' locations are blurred whenever they are, not only when TaiCOL rates it", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    // A taxon with public records that TaiCOL leaves unrated, but that the
    // database blurs anyway (protection, the Red List, a floor, its species).
    const [sp] = await sql`
      select t.id from taxa t join species_report_stats s on s.taxon_id = t.id
       where t.sensitivity is null and taxon_precision(t.id) in ('coarse_10km', 'coarse_50km')
         and t.taxon_status = 'accepted'
       order by s.report_count desc limit 1`;
    if (!sp) return t.skip("no blurred-but-unrated taxon with records here");
    const html = await (await fetch(`${BASE_URL}/en/species/${sp.id}`, { redirect: "follow" })).text();
    assert.match(html, /Every location of this species is shown blurred/);
    assert.match(html, /href="\/en\/about#blurred"/);
  });

  test("an endemic subspecies is not called an endemic species", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const [sp] = await sql`
      select t.id from taxa t
       where t.is_endemic and t.rank = 'Subspecies' and t.taxon_status = 'accepted' and t.is_in_taiwan
       order by t.id limit 1`;
    if (!sp) return t.skip("no endemic subspecies here");
    const html = await (await fetch(`${BASE_URL}/en/species/${sp.id}`, { redirect: "follow" })).text();
    assert.match(html, />Endemic subspecies</);
    assert.doesNotMatch(html, />Endemic</);
  });

  test("a name under review says so", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const [sp] = await sql`select id from taxa where taicol_id = 't0101610'`;
    if (!sp) return t.skip("日本樹蛙 is not in this database");
    const html = await (await fetch(`${BASE_URL}/en/species/${sp.id}`, { redirect: "follow" })).text();
    assert.match(html, /Name under review/);
  });
});
