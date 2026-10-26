/**
 * Each species once (migration 0040).
 *
 * TaiCOL lists 家燕 Hirundo rustica as a species row and three subspecies rows,
 * every one called 家燕, and the directory printed a card for each: the same
 * title three times with the records split between them. The invasive list
 * had eleven names twice, and its 埃及聖䴉 species line said 尚無紀錄 beside
 * the subspecies line that held every record. Now a subspecies with its
 * species' Chinese name is shown on the species' card (species_folds), and
 * everything a card says is counted over the rows it covers.
 *
 * What may never happen is that a card joins rows the site blurs differently,
 * so most of this file is about that, and about 0040 leaving every record as
 * it was. The fixture carries the two groups by name: 家燕 with its three
 * subspecies, and 埃及聖䴉 with its one.
 *
 *   node --test test/species-cards.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { BASE_URL, sql, inRollback, requireServer } from "./helpers.mjs";

const SWALLOW = { species: 97276, subspecies: [85752, 85753, 85754] };
const IBIS = { species: 99144, subspecies: 86360 };

const MIGRATION = readFileSync(
  join(import.meta.dirname, "../../../supabase/migrations/0040_species_key.sql"),
  "utf8",
);

const nonces = [];

after(async () => {
  if (nonces.length)
    await sql`delete from reports where client_nonce = any(${nonces})`;
  await sql.end();
});

const html = async (path) => {
  const res = await fetch(`${BASE_URL}${path}`);
  return { status: res.status, body: await res.text() };
};

/** The directory's count of cards, as countSpecies() makes it (lib/species.ts). */
const cardCount = (tx, where = sql`true`) => tx`
  select count(distinct coalesce(f.species_id, t.id))::int as n
    from taxa t
    left join species_report_stats s on s.taxon_id = t.id
    left join species_folds f on f.taxon_id = t.id
   where t.taxon_status is not distinct from 'accepted' and t.is_in_taiwan
     and t.rank in ('Species','Subspecies')
     and ${where}`.then((r) => r[0].n);

/** Records under a card, as a species page counts them. */
const cardRecords = (id) => sql`
  select count(*)::int as n from reports_public
   where taxon_id in (select taxon_id from species_card_members where card_id = ${id})`
  .then((r) => r[0].n);

describe("the species key", () => {
  test("a subspecies names its species; a species and the ranks above, none", async () => {
    const rows = await sql`
      select t.id, t.rank, t.taicol_id, t.species_taicol_id
        from taxa t
       where t.id in (${SWALLOW.species}, ${SWALLOW.subspecies[0]}, ${IBIS.subspecies})`;
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    // A species is its own, so only the rows below one carry the key: 5,573
    // rows written by the fill rather than 95,000 (see the migration).
    assert.equal(by[SWALLOW.species].species_taicol_id, null);
    assert.equal(by[SWALLOW.subspecies[0]].species_taicol_id, "t0097276");
    assert.equal(by[IBIS.subspecies].species_taicol_id, "t0099144");
    // 石虎 is a subspecies of 豹貓 and keeps its own Chinese name: the key
    // still says which species it is, and it is not folded (below).
    const [cat] = await sql`select species_taicol_id from taxa where taicol_id = 't0105762'`;
    if (cat) assert.equal(cat.species_taicol_id, "t0032116");
    const [{ above }] = await sql`
      select count(*)::int as above from taxa
       where not coalesce(is_infraspecific(rank), false) and species_taicol_id is not null`;
    assert.equal(above, 0, "a species or a row above one has a species key");
  });

  test("filling it again changes nothing", async () => {
    await inRollback(async (tx) => {
      const [{ n }] = await tx`select resolve_species_keys() as n`;
      assert.equal(Number(n), 0);
    });
  });

  test("a TaiCOL refresh fills it: resolve_taxa_lineage() calls the fill", async () => {
    // Both importers end with resolve_taxa_lineage() (scripts/import-taicol.ts
    // and zz-lineage.sql from scripts/taicol-sql.ts). Run here it would
    // rewrite the lineage of every row, so its body is read instead.
    const [{ src }] = await sql`
      select prosrc as src from pg_proc where proname = 'resolve_taxa_lineage'`;
    assert.match(src, /perform resolve_species_keys\(\)/);
  });
});

describe("a card never joins rows blurred differently", () => {
  test("every fold, across the whole database, joins rows taxon_precision() blurs alike", async () => {
    // Asked on the server's own connection of taxon_precision() itself, not of
    // the view's own check: this is the rule, the view is what keeps it. Most
    // folds are settled by the view without asking taxon_precision() (a
    // subspecies with nothing of its own takes its species' rule), so this is
    // also what fails if taxon_precision() ever reads something the view's
    // shortcut does not.
    const bad = await sql`
      select f.taxon_id, f.species_id,
             taxon_precision(f.taxon_id) as sub, taxon_precision(f.species_id) as sp
        from species_folds f
       where taxon_precision(f.taxon_id) is distinct from taxon_precision(f.species_id)`;
    assert.deepEqual([...bad], []);
    // A card is a species and the subspecies folded into it, so a card with
    // two rules is a fold that broke this one.
  });

  test("the fixture's groups fold: 家燕 onto its species, 埃及聖䴉 too", async () => {
    const folds = await sql`select taxon_id, species_id from species_folds
                             where species_id in (${SWALLOW.species}, ${IBIS.species})
                             order by taxon_id`;
    assert.deepEqual(
      folds.map((f) => [f.taxon_id, f.species_id]),
      [
        ...SWALLOW.subspecies.map((id) => [id, SWALLOW.species]),
        [IBIS.subspecies, IBIS.species],
      ].sort((a, b) => a[0] - b[0]),
    );
    const [cat] = await sql`select id from taxa where taicol_id = 't0105762'`;
    if (cat) {
      const [{ n }] = await sql`select count(*)::int as n from species_folds where taxon_id = ${cat.id}`;
      assert.equal(n, 0, "石虎 has a name of its own and keeps its own card");
    }
  });

  test("a subspecies protected by law leaves its species' card", async () => {
    await inRollback(async (tx) => {
      const sub = SWALLOW.subspecies[0];
      const before = await cardCount(tx, tx`t.common_name_zh = '家燕'`);
      assert.equal(before, 1);
      await tx`update taxa set protected_status = 'II' where id = ${sub}`;
      const [{ rule }] = await tx`select taxon_precision(${sub}) as rule`;
      assert.equal(rule, "coarse_10km");
      const folds = await tx`select 1 from species_folds where taxon_id = ${sub}`;
      assert.equal(folds.length, 0, "a 10 km subspecies stayed on an exact species' card");
      assert.equal(await cardCount(tx, tx`t.common_name_zh = '家燕'`), 2);
      // Its records are no longer counted on the species.
      const [{ inSpecies }] = await tx`
        select count(*)::int as "inSpecies" from species_card_members
         where card_id = ${SWALLOW.species} and taxon_id = ${sub}`;
      assert.equal(inSpecies, 0);
    });
  });

  test("so does one held by a floor, which only the server can read", async () => {
    await inRollback(async (tx) => {
      const sub = SWALLOW.subspecies[1];
      await tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
               select taicol_id, 'coarse_50km', 'species-cards.test.mjs' from taxa where id = ${sub}`;
      const folds = await tx`select 1 from species_folds where taxon_id = ${sub}`;
      assert.equal(folds.length, 0);
      // And the public role sees the same: the view asks on its behalf, while
      // the floors themselves stay closed to it.
      await tx`set local role web_anon`;
      const asPublic = await tx`select 1 from species_folds where taxon_id = ${sub}`;
      assert.equal(asPublic.length, 0);
      await assert.rejects(tx`select count(*) from taxon_precision_floors`, /permission denied/);
    });
  });

  test("a floor on the species blurs its subspecies alike, and they stay one card", async () => {
    // The rule, not the inputs, decides: taxon_precision() climbs from a
    // subspecies to its species, so the subspecies takes the species' floor.
    await inRollback(async (tx) => {
      await tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
               values ('t0097276', 'coarse_10km', 'species-cards.test.mjs')`;
      const rules = await tx`
        select distinct taxon_precision(id) as rule from taxa
         where id in ${tx([SWALLOW.species, ...SWALLOW.subspecies])}`;
      assert.deepEqual(rules.map((r) => r.rule), ["coarse_10km"]);
      assert.equal(await cardCount(tx, tx`t.common_name_zh = '家燕'`), 1);
    });
  });

  test("a subspecies protected as its species is stays on its card", async () => {
    // Its own protection sends the view to taxon_precision() for the answer,
    // and the answer is the species' rule: 10 km for both.
    await inRollback(async (tx) => {
      await tx`update taxa set protected_status = 'II'
                where id in ${tx([SWALLOW.species, SWALLOW.subspecies[0]])}`;
      const [{ a, b }] = await tx`
        select taxon_precision(${SWALLOW.species}) as a, taxon_precision(${SWALLOW.subspecies[0]}) as b`;
      assert.equal(a, "coarse_10km");
      assert.equal(b, a);
      const folds = await tx`select species_id from species_folds where taxon_id = ${SWALLOW.subspecies[0]}`;
      assert.deepEqual(folds.map((f) => f.species_id), [SWALLOW.species]);
    });
  });

  test("a subspecies flagged invasive differently keeps its own card", async () => {
    await inRollback(async (tx) => {
      await tx`update taxa set is_invasive = true where id = ${SWALLOW.subspecies[2]}`;
      const folds = await tx`select 1 from species_folds where taxon_id = ${SWALLOW.subspecies[2]}`;
      assert.equal(folds.length, 0);
    });
  });

  test("the blur check is the public role's alone", async () => {
    const [row] = await sql`
      select has_function_privilege('web_anon', 'public.same_taxon_precision(bigint,bigint)', 'execute') as anon_role,
             (select prosecdef from pg_proc where proname = 'same_taxon_precision') as definer`;
    assert.equal(row.anon_role, true);
    assert.equal(row.definer, true);
    for (const role of ["anon", "authenticated"]) {
      const [r] = await sql`select 1 from pg_roles where rolname = ${role}`;
      if (!r) continue;
      const [p] = await sql`
        select has_function_privilege(${role}, 'public.same_taxon_precision(bigint,bigint)', 'execute') as fn,
               has_table_privilege(${role}, 'public.species_folds', 'select') as folds,
               has_table_privilege(${role}, 'public.species_card_stats', 'select') as stats`;
      assert.deepEqual(p, { fn: false, folds: false, stats: false }, role);
    }
  });
});

describe("0040 changes no record", () => {
  test("applied to keys that were never filled, every report is as it was", async () => {
    await inRollback(async (tx) => {
      await tx`create temp table before_0040 as
                 select id, taxon_id, location_precision, precision_override, is_obscured,
                        status, location::text as at, location_public::text as shown
                   from reports`;
      // As production stands before it, for every row a record names and the
      // species above each: no species key. Not every row in taxa, because
      // that holds row locks on all of a shared database's checklist for the
      // length of the test.
      await tx`update taxa set species_taicol_id = null
                where id in (select taxon_id from reports where taxon_id is not null)
                   or taicol_id in (select t.species_taicol_id from reports r
                                      join taxa t on t.id = r.taxon_id)`;
      await tx.unsafe(MIGRATION).simple();
      const [{ changed, gone }] = await tx`
        select (select count(*)::int from (
                  select id, taxon_id, location_precision, precision_override, is_obscured,
                         status, location::text, location_public::text from reports
                  except select * from before_0040) d) as changed,
               (select count(*)::int from (
                  select * from before_0040
                  except select id, taxon_id, location_precision, precision_override, is_obscured,
                                status, location::text, location_public::text from reports) d) as gone`;
      assert.equal(changed, 0, "0040 changed a record");
      assert.equal(gone, 0, "0040 removed or altered a record");
      const [{ keyed }] = await tx`
        select count(*)::int as keyed from taxa where species_taicol_id is not null`;
      assert.ok(keyed > 0, "0040 filled no species key");
    });
  });
});

describe("the pages", () => {
  test("/species lists 家燕 once, as the species, with every record", async (t) => {
    if (!(await requireServer(t))) return;
    const { status, body } = await html(`/species?q=${encodeURIComponent("家燕")}`);
    assert.equal(status, 200);
    const linked = [...body.matchAll(/href="\/species\/(\d+)-/g)].map((m) => Number(m[1]));
    assert.ok(linked.includes(SWALLOW.species), "the species is not listed");
    for (const id of SWALLOW.subspecies)
      assert.ok(!linked.includes(id), `subspecies ${id} has a card of its own`);
    const total = await cardRecords(SWALLOW.species);
    const [{ own }] = await sql`
      select count(*)::int as own from reports_public where taxon_id = ${SWALLOW.species}`;
    assert.ok(total > own, "the fixture's subspecies records are missing");
    const card = body.match(new RegExp(`href="/species/${SWALLOW.species}-[^"]*"[\\s\\S]*?</a>`))?.[0] ?? "";
    assert.match(card, new RegExp(`>${total}<`), `the card does not say ${total}`);
  });

  test("a subspecies' name finds its species' card", async (t) => {
    if (!(await requireServer(t))) return;
    const { body } = await html("/species?q=gutturalis");
    const linked = [...body.matchAll(/href="\/species\/(\d+)-/g)].map((m) => Number(m[1]));
    assert.ok(linked.includes(SWALLOW.species));
    assert.ok(!linked.includes(SWALLOW.subspecies[0]));
  });

  test("/api/health states the directory's count", async (t) => {
    if (!(await requireServer(t))) return;
    // Twice at most: the suite commits reports while it runs, and one could
    // land between the two reads.
    for (let i = 0; ; i++) {
      const health = await (await fetch(`${BASE_URL}/api/health`)).json();
      const n = await cardCount(sql, sql`s.report_count is not null`);
      if (health.species === n || i === 1) {
        assert.equal(health.species, n);
        break;
      }
    }
  });

  test("/invasive lists 埃及聖䴉 once, on the line with its records", async (t) => {
    if (!(await requireServer(t))) return;
    const { status, body } = await html("/invasive");
    assert.equal(status, 200);
    const lines = [...body.matchAll(new RegExp(`href="/species/(${IBIS.species}|${IBIS.subspecies})-`, "g"))];
    assert.deepEqual(lines.map((m) => Number(m[1])), [IBIS.species]);
    const n = await cardRecords(IBIS.species);
    assert.ok(n > 0, "the fixture's ibis records are missing");
    const line = body.match(new RegExp(`href="/species/${IBIS.species}-[^"]*"[\\s\\S]*?</a>`))?.[0] ?? "";
    assert.match(line, new RegExp(`${n} 筆紀錄`));
  });

  test("/invasive prints no TaiCOL note and starts with its groups closed", async (t) => {
    if (!(await requireServer(t))) return;
    const { body } = await html("/invasive");
    assert.ok(!body.includes("Bird Record Committee"), "a TaiCOL note is still on the list");
    const groups = [...body.matchAll(/<details[^>]*>/g)].map((m) => m[0]);
    assert.ok(groups.length > 0, "the groups are not disclosures");
    assert.ok(groups.every((g) => !/\bopen\b/.test(g)), "a group starts open");
  });

  test("the species page counts its subspecies and keeps TaiCOL's note under its sources", async (t) => {
    if (!(await requireServer(t))) return;
    const { status, body } = await html(`/species/${IBIS.species}-threskiornis-aethiopicus`);
    assert.equal(status, 200);
    const n = await cardRecords(IBIS.species);
    assert.match(body, new RegExp(`${n} 筆紀錄`));
    // Linked to the subspecies it counts.
    assert.match(body, new RegExp(`href="/species/${IBIS.subspecies}-`));
    const details = body.match(/<details[\s\S]*?<\/details>/)?.[0] ?? "";
    assert.match(details, /資料來源/);
    assert.match(details, /Bird Record Committee, 2022/);
  });

  test("the species' map draws the records its page counts", async (t) => {
    if (!(await requireServer(t))) return;
    // A z6 tile over all of Taiwan, filtered as SpeciesMap filters it. Its
    // cells' weights are the records under them, so they add up to the card.
    const weight = async (id) => {
      const res = await fetch(`${BASE_URL}/api/tiles/6/53/27?taxonId=${id}`);
      assert.equal(res.status, 200);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0) return 0;
      const layer = new VectorTile(new PbfReader(buf)).layers.reports;
      let sum = 0;
      for (let i = 0; i < (layer?.length ?? 0); i++) sum += layer.feature(i).properties.weight;
      return sum;
    };
    assert.equal(await weight(SWALLOW.species), await cardRecords(SWALLOW.species));
    // A folded subspecies' own map is its own records.
    assert.equal(await weight(SWALLOW.subspecies[0]), await cardRecords(SWALLOW.subspecies[0]));
  });

  test("the record list filtered to the species holds its subspecies' records", async (t) => {
    if (!(await requireServer(t))) return;
    const [rec] = await sql`
      select id::text from reports_public where taxon_id = ${IBIS.subspecies} order by observed_at desc, id limit 1`;
    assert.ok(rec, "the fixture's ibis records are missing");
    const { status, body } = await html(`/reports?taxonId=${IBIS.species}`);
    assert.equal(status, 200);
    assert.match(body, new RegExp(`href="/reports/${rec.id}"`));
  });

  test("a subspecies' page still answers, and links to its species", async (t) => {
    if (!(await requireServer(t))) return;
    const { status, body } = await html(`/species/${SWALLOW.subspecies[0]}-hirundo-rustica-gutturalis`);
    assert.equal(status, 200);
    assert.match(body, new RegExp(`href="/species/${SWALLOW.species}-hirundo-rustica"`));
  });

  test("the picker offers 家燕 once, as the species", async (t) => {
    if (!(await requireServer(t))) return;
    for (const params of [{ q: "家燕", page: "wildlife" }, { q: "家燕", page: "roadkill" }, { q: "gutturalis", page: "wildlife" }]) {
      const { results } = await (
        await fetch(`${BASE_URL}/api/species/search?${new URLSearchParams(params)}`)
      ).json();
      const ids = results.map((r) => r.id);
      assert.ok(ids.includes(SWALLOW.species), JSON.stringify(params));
      for (const id of SWALLOW.subspecies) assert.ok(!ids.includes(id), `${id} for ${JSON.stringify(params)}`);
    }
  });

  test("a report naming a folded subspecies is still filed under it", async (t) => {
    // What a phone queued before the picker changed must still go through:
    // the offline queue treats a refusal as final.
    if (!(await requireServer(t))) return;
    await sql`delete from rate_limits where key like 'submit-%'`;
    const clientNonce = randomUUID();
    nonces.push(clientNonce);
    const res = await fetch(`${BASE_URL}/api/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: "sighting",
        lng: 120.9,
        lat: 23.8,
        observedAt: new Date().toISOString(),
        photoPaths: [],
        clientNonce,
        taxonId: SWALLOW.subspecies[0],
      }),
    });
    assert.equal(res.status, 201, await res.text());
    const [row] = await sql`select taxon_id from reports where client_nonce = ${clientNonce}`;
    assert.equal(row.taxon_id, SWALLOW.subspecies[0]);
  });
});
