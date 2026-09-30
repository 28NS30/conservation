/**
 * What a blurred record, and the database behind it, may say. From the
 * security audit of 29 September 2026; migrations 0024 and 0025, and the
 * naming rules in lib/report/precision.ts, reports/[id]/actions.ts and the
 * classifier.
 *
 * Each database test builds its own taxa inside a rolled-back transaction, so
 * it asserts the rule, not what TaiCOL says this month.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql, inRollback, insertReport, BASE_URL } from "./helpers.mjs";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");

let seq = 0;
const uid = () => `test-say-less-${process.pid}-${Date.now()}-${seq++}`;
const binomial = () => `Testudosayless e${process.pid}x${Date.now()}x${seq++}`;

async function taxon(tx, { sensitivity = null } = {}) {
  const [t] = await tx`
    insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan, sensitivity, taxon_status)
    values (${uid()}, ${binomial()}, 'Species', true, ${sensitivity}, 'accepted')
    returning id`;
  return t.id;
}

describe("notes (0025)", () => {
  test("a blurred record publishes no notes; an exact one does", async () => {
    await inRollback(async (tx) => {
      const rare = await taxon(tx, { sensitivity: "重度" });
      const common = await taxon(tx);
      const blurred = await insertReport(tx, { taxonId: rare });
      const exact = await insertReport(tx, { taxonId: common });
      await tx`update reports set notes = 'by the 23 km marker' where id in (${blurred.id}, ${exact.id})`;
      const rows = await tx`
        select id, notes, location_precision from reports_public where id in (${blurred.id}, ${exact.id})`;
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      assert.notEqual(byId[blurred.id].location_precision, "exact");
      assert.equal(byId[blurred.id].notes, null, "a blurred record published its notes");
      assert.equal(byId[exact.id].notes, "by the 23 km marker");
    });
  });
});

describe("the model's suggestions (0025)", () => {
  async function suggested(tx, reportId, taxonIds) {
    await tx`update reports set ai_band = 'medium' where id = ${reportId}`;
    let rank = 1;
    for (const t of taxonIds)
      await tx`insert into classifications (report_id, taxon_id, score, rank, model_version)
               values (${reportId}, ${t}, ${0.5 / rank}, ${rank++}, 'test')`;
  }
  const publicList = async (tx, id) => {
    await tx`set local role web_anon`;
    const rows = await tx`select taxon_id from report_ai_suggestions where report_id = ${id}`;
    await tx`reset role`;
    return rows;
  };

  test("a list naming a species stricter than the record is withheld whole", async () => {
    await inRollback(async (tx) => {
      const rare = await taxon(tx, { sensitivity: "重度" });
      const common = await taxon(tx);
      // Named as the common species, so shown exactly, with the rare one on its list.
      const r = await insertReport(tx, { taxonId: common });
      await suggested(tx, r.id, [common, rare]);
      assert.equal(r.location_precision, "exact");
      assert.equal((await publicList(tx, r.id)).length, 0, "the list named a stricter species beside a closer point");
    });
  });

  test("a list no stricter than the record is still shown", async () => {
    await inRollback(async (tx) => {
      const a = await taxon(tx);
      const b = await taxon(tx);
      const r = await insertReport(tx, { taxonId: a });
      await suggested(tx, r.id, [a, b]);
      assert.equal((await publicList(tx, r.id)).length, 2);
    });
  });
});

describe("the REST API cannot call the site's functions (0024)", () => {
  test("anon and authenticated can execute none of them", async (t) => {
    const [roles] = await sql`select exists (select 1 from pg_roles where rolname = 'anon') as ok`;
    if (!roles.ok) return t.skip("no anon role on this cluster");
    const rows = await sql`
      select p.oid::regprocedure::text as f
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and (has_function_privilege('anon', p.oid, 'execute')
              or has_function_privilege('authenticated', p.oid, 'execute'))
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;
    assert.deepEqual(rows.map((r) => r.f), []);
  });

  test("web_anon can still answer the suggestions check", async () => {
    const [r] = await sql`
      select has_function_privilege('web_anon', 'public.suggestions_within_blur(uuid,text)', 'execute') as ok`;
    assert.equal(r.ok, true);
  });
});

describe("naming never loosens a decision", () => {
  test("a hold stricter than the unidentified stamp survives naming", () => {
    const src = read("lib", "report", "precision.ts");
    const rule = src.slice(src.indexOf("export const keepDeliberateOverride"), src.indexOf("export const photoIdentificationOverride"));
    assert.match(rule, /precision_rank\(precision_override\)\s*>\s*precision_rank\(\$\{UNIDENTIFIED_PRECISION\}::text\)/);
  });

  test("a reporter cannot replace a moderator's identification, nor loosen their own", () => {
    const src = read("app", "[locale]", "(site)", "reports", "[id]", "actions.ts");
    assert.match(src, /if \(!moderator && report\.taxon_source === "expert"\)/);
    assert.match(src, /stricter_precision\(\$\{photoIdentificationOverride\(taxonId\)\}, location_precision\)/);
    const page = read("app", "[locale]", "(site)", "reports", "[id]", "page.tsx");
    assert.match(page, /owner\?\.reporter_id === userId && row\.taxon_source !== "expert"/);
  });
});

describe("the classifier lifts only its own hold", () => {
  for (const file of ["classifyWorker.ts", "classifyEvidence.ts"]) {
    test(`${file}: publishes only reports held for identification, and only if unchanged`, () => {
      const src = read("lib", "report", file);
      assert.doesNotMatch(src, /status = case when status = 'pending' then 'published'/,
        "a publish that ignores why the report was held");
      assert.equal((src.match(/status = 'pending' and flagged_reason is null then 'published'/g) ?? []).length, 2);
      assert.ok((src.match(/taxon_id is not distinct from \$\{job\.taxon_id\}::bigint/g) ?? []).length >= 2,
        "a model write that can overwrite a person's identification made while it ran");
      assert.doesNotMatch(src, /flagged_reason = \$\{/, "a classifier write that replaces the screen's reason");
    });
  }
});

describe("words that give a location are held for a moderator", () => {
  const nonces = [];
  after(async () => {
    await sql`delete from reports where client_nonce = any(${nonces})`;
  });

  for (const [what, extra] of [
    ["coordinates in the notes", { notes: "found at 25.0330, 121.5654 by the road" }],
    ["a map link in the notes", { notes: "https://maps.app.goo.gl/abc123 here" }],
  ]) {
    test(what, async (t) => {
      if (!(await fetch(BASE_URL).catch(() => null))) return t.skip(`no server at ${BASE_URL}`);
      await sql`delete from rate_limits where key like 'submit-%'`;
      const clientNonce = randomUUID();
      nonces.push(clientNonce);
      const res = await fetch(`${BASE_URL}/api/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "sighting", page: "wildlife", lng: 121.5, lat: 25.0,
          observedAt: new Date().toISOString(), photoPaths: [], clientNonce,
          taxonUnknown: true, ...extra,
        }),
      });
      assert.equal(res.status, 201);
      const [row] = await sql`select status, flagged_reason from reports where client_nonce = ${clientNonce}`;
      assert.equal(row.status, "pending", "a location in words was published without review");
      assert.equal(row.flagged_reason, "a location in the notes or credit");
    });
  }
});

describe("a credit name that gives a place or a way to reach someone is not kept", () => {
  const nonces = [];
  after(async () => {
    await sql`delete from reports where client_nonce = any(${nonces})`;
  });

  for (const [what, creditName, kept] of [
    ["coordinates", "25.0330 121.5654", null],
    ["a map link", "maps.app.goo.gl/abc123", null],
    ["a phone number", "0912-345-678", null],
    ["a nickname", "小明", "小明"],
  ]) {
    test(`${what}: ${kept ? "kept" : "dropped, and the report is not held for it"}`, async (t) => {
      if (!(await fetch(BASE_URL).catch(() => null))) return t.skip(`no server at ${BASE_URL}`);
      await sql`delete from rate_limits where key like 'submit-%'`;
      const clientNonce = randomUUID();
      nonces.push(clientNonce);
      const res = await fetch(`${BASE_URL}/api/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "sighting", page: "wildlife", lng: 121.5, lat: 25.0,
          observedAt: new Date().toISOString(), photoPaths: [], clientNonce,
          taxonUnknown: true, license: "cc-by-4.0", creditName,
        }),
      });
      assert.equal(res.status, 201);
      const [row] = await sql`select rights_holder, flagged_reason from reports where client_nonce = ${clientNonce}`;
      assert.equal(row.rights_holder, kept);
      assert.doesNotMatch(row.flagged_reason ?? "", /location|contact/);
    });
  }
});

describe("a sibling that tightens re-blurs records named under its binomial (0026)", () => {
  test("a photo-named species record follows its subspecies to 50 km", async () => {
    await inRollback(async (tx) => {
      const name = binomial();
      const [sp] = await tx`
        insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan, taxon_status)
        values (${uid()}, ${name}, 'Species', true, 'accepted') returning id, taicol_id`;
      const [ssp] = await tx`
        insert into taxa (taicol_id, parent_taicol_id, scientific_name, rank, is_in_taiwan, taxon_status)
        values (${uid()}, ${sp.taicol_id}, ${name + " minor"}, 'Subspecies', true, 'accepted') returning id`;
      const r = await insertReport(tx, { taxonId: sp.id });
      await tx`update reports set taxon_source = 'ai' where id = ${r.id}`;
      assert.equal(r.location_precision, "exact");

      await tx`update taxa set sensitivity = '重度' where id = ${ssp.id}`;
      const [after] = await tx`select location_precision from reports where id = ${r.id}`;
      assert.equal(after.location_precision, "coarse_50km", "the species record stayed exact beside a 50 km subspecies");
    });
  });

  test("a GBIF import keeps its own taxon's rule", async () => {
    await inRollback(async (tx) => {
      const name = binomial();
      const [sp] = await tx`
        insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan, taxon_status)
        values (${uid()}, ${name}, 'Species', true, 'accepted') returning id, taicol_id`;
      const [ssp] = await tx`
        insert into taxa (taicol_id, parent_taicol_id, scientific_name, rank, is_in_taiwan, taxon_status)
        values (${uid()}, ${sp.taicol_id}, ${name + " minor"}, 'Subspecies', true, 'accepted') returning id`;
      const r = await insertReport(tx, { taxonId: sp.id });
      await tx`update taxa set sensitivity = '重度' where id = ${ssp.id}`;
      const [after] = await tx`select location_precision from reports where id = ${r.id}`;
      assert.equal(after.location_precision, "exact");
    });
  });
});
