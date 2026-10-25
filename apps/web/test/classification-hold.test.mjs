/**
 * A named report with a photo is held at 10 km until the model has looked.
 *
 * The reporter's word was the only thing that said what the animal was, and
 * the record was public at that word's blur from the moment it was filed: a
 * dead 石虎 filed as 家貓 sat on the map to the metre, notes and all, until the
 * model said otherwise, and for good if the model never answered. So the
 * report is published held at the stricter of its species' rule and the
 * unidentified blur (`held_for_classification`, migration 0033), and the
 * classifier releases it to the decided blur when it has run
 * (lib/report/classificationHold.ts). If the model never answers, it stays
 * held.
 *
 * The release is checked here against everything it could be mistaken for: it
 * must never take a record below its species' rule, never clear an override,
 * and happen in no path but a finished classification.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { UNIDENTIFIED_PRECISION } from "@conservation/shared";
import { BASE_URL, sql, inRollback, insertReport } from "./helpers.mjs";
import {
  recordBesidePerson,
  settleClassificationHold,
} from "../lib/report/classificationHold.ts";

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const WORKER = read("lib", "report", "classifyWorker.ts");
const EVIDENCE = read("lib", "report", "classifyEvidence.ts");
const ROUTE = read("app", "api", "reports", "route.ts");
const MIGRATION = readFileSync(
  join(WEB, "..", "..", "supabase", "migrations", "0033_blur_disagreements_and_higher_ranks.sql"),
  "utf8",
);
/** Source with comment lines dropped, so an assertion never matches prose. */
const code = (src) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|--)/.test(l))
    .join("\n");

const RANK = { exact: 0, coarse_10km: 1, coarse_50km: 2, suppressed: 3 };
const stricter = (a, b) => (RANK[a] >= RANK[b] ? a : b);

const nonces = [];
const uploaded = [];
after(async () => {
  if (nonces.length) await sql`delete from reports where client_nonce = any(${nonces})`;
  if (uploaded.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      .storage.from("report-photos")
      .remove(uploaded)
      .catch(() => {});
  }
  await sql.end();
});

let seq = 0;
async function row(tx, { sensitivity = null, protectedStatus = null, invasive = false } = {}) {
  const [t] = await tx`
    insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan, taxon_status,
                      sensitivity, protected_status, is_invasive)
    values (${`test-ch-${process.pid}-${Date.now()}-${seq}`},
            ${`Testudofixtura h${process.pid}x${Date.now()}x${seq++}`}, 'Species',
            true, 'accepted', ${sensitivity}, ${protectedStatus}, ${invasive})
    returning id`;
  // Asked after the insert: RETURNING runs on a snapshot without the new row.
  const [{ rule }] = await tx`select taxon_precision(${t.id}) as rule`;
  return { ...t, rule: rule ?? "exact" };
}

/** A report its reporter named with a photo, inserted held as POST /api/reports inserts one. */
async function held(tx, taxonId, override = null) {
  const [{ id }] = await tx`
    insert into reports (category, location, location_public, observed_at, taxon_id,
                         taxon_source, status, source, precision_override,
                         held_for_classification)
    values ('roadkill',
            st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
            st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
            now(), ${taxonId}, 'user', 'published', 'user', ${override}, true)
    returning id`;
  return { ...(await state(tx, id)), id, taxonId };
}
const state = async (tx, id) =>
  (await tx`select taxon_id, precision_override, location_precision,
                   held_for_classification as held, status, flagged_reason
              from reports where id = ${id}`)[0];
/** The classifier's record branch, the model's answer being `model`. */
const classify = (tx, r, model = null) =>
  recordBesidePerson(tx, {
    reportId: r.id,
    claimedTaxonId: r.taxonId,
    claimedSource: "user",
    score: 0.97,
    band: "high",
    disagreeingTaxonId: model,
  });

describe("the route holds a named report with a photo, and nothing else", () => {
  const route = code(ROUTE);

  test("held when it is named and will be classified", () => {
    assert.match(route, /const heldForClassification = classifiable && identified;/);
    assert.match(route, /consent_version, consent_at, is_test, held_for_classification\s*\) values \(/);
    assert.match(route, /\$\{isTest\},\s*\$\{heldForClassification\}\s*\)/);
    // The job that releases it is written in the same transaction.
    assert.match(route, /if \(classifiable\) \{\s*await tx`insert into classification_jobs/);
  });

  test("the hold is the trigger's, at the unidentified blur", async () => {
    assert.equal(UNIDENTIFIED_PRECISION, "coarse_10km");
    assert.match(
      MIGRATION,
      /p := stricter_precision\(report_precision\(new\.taxon_id, new\.precision_override\),\s*case when new\.held_for_classification then 'coarse_10km' end\);/,
    );
    const [trigger] = await sql`
      select pg_get_triggerdef(t.oid) as def from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
       where c.relname = 'reports' and t.tgname = 'reports_set_public_location'`;
    assert.match(trigger.def, /UPDATE OF location, taxon_id, precision_override, held_for_classification/,
      "releasing the hold would not re-blur the record");
  });
});

describe("held at insert", () => {
  test("an unrated species is published at 10 km, not to the metre", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const r = await held(tx, cat.id);
      assert.equal(r.location_precision, "coarse_10km");
      assert.equal(r.status, "published", "the hold does not keep it off the map");
      assert.equal(r.precision_override, null, "the hold is not an override");
      const [pub] = await tx`select notes, location_precision from reports_public where id = ${r.id}`;
      assert.equal(pub.location_precision, "coarse_10km");
    });
  });

  test("a stricter species keeps its own rule", async () => {
    await inRollback(async (tx) => {
      for (const sensitivity of ["重度", "座標不開放"]) {
        const owl = await row(tx, { sensitivity });
        const r = await held(tx, owl.id);
        assert.equal(r.location_precision, owl.rule, sensitivity);
      }
    });
  });

  test("and a blurred record publishes no notes while it is held", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const r = await held(tx, cat.id);
      await tx`update reports set notes = 'by the 23 km marker' where id = ${r.id}`;
      const [pub] = await tx`select notes from reports_public where id = ${r.id}`;
      assert.equal(pub.notes, null);
    });
  });
});

describe("released when the classifier has run", () => {
  test("to the species' own rule when the model agrees", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const r = await held(tx, cat.id);
      await classify(tx, r, null);
      const after_ = await state(tx, r.id);
      assert.equal(after_.held, false);
      assert.equal(after_.location_precision, "exact");
      assert.equal(after_.precision_override, null, "the release wrote a stamp");
      assert.equal(after_.flagged_reason, null);
    });
  });

  test("a named invasive species ends at its exact spot, as the owner decided", async () => {
    await inRollback(async (tx) => {
      const myna = await row(tx, { invasive: true });
      const r = await held(tx, myna.id);
      assert.equal(r.location_precision, "coarse_10km");
      await classify(tx, r, null);
      assert.equal((await state(tx, r.id)).location_precision, "exact");
    });
  });

  test("tightened to the model's species when the model, sure, names another", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const leopardCat = await row(tx, { protectedStatus: "I", sensitivity: "重度" });
      const r = await held(tx, cat.id);
      await classify(tx, r, leopardCat.id);
      const after_ = await state(tx, r.id);
      assert.equal(after_.held, false);
      assert.equal(Number(after_.taxon_id), Number(cat.id), "the reporter's species is kept");
      assert.equal(after_.location_precision, "coarse_50km");
      assert.equal(after_.precision_override, "coarse_50km");
    });
  });

  test("also when the model named the species itself, or only suggested", () => {
    // A held report reaches those branches only if a moderator removed its
    // name before the model ran; the classifier has run all the same.
    for (const src of [code(WORKER), code(EVIDENCE)]) {
      const assign = src.slice(src.indexOf('=== "assign"'), src.indexOf('=== "record"'));
      assert.match(assign, /held_for_classification = false,/, "the assign branch keeps the hold");
      const suggest = src.slice(src.indexOf('=== "record"'));
      const update = suggest.slice(suggest.indexOf("} else {"));
      assert.match(update, /held_for_classification = false,/, "the suggest branch keeps the hold");
    }
  });
});

describe("held when the classifier fails", () => {
  // Both give-up paths of the worker, read out of the source and run as
  // written: the job's own, and the sweep that retires a job which died
  // during its last attempt. Neither touches a published record.
  const giveUp = (() => {
    const m = /update reports\s+set precision_override = stricter_precision\(precision_override,[\s\S]*?and status = 'pending'`/.exec(WORKER);
    assert.ok(m, "the give-up update moved");
    return m[0]
      .slice(0, -1)
      .replaceAll("${UNIDENTIFIED_PRECISION}", "'coarse_10km'")
      .replaceAll("${job.report_id}", "$1");
  })();
  const sweep = (() => {
    const from = WORKER.indexOf("with stuck as (");
    const body = WORKER.slice(from, WORKER.indexOf("`;", from));
    return body
      .replaceAll("${MAX_ATTEMPTS}", "5")
      .replaceAll("${STALE_AFTER}", "'5 minutes'")
      .replaceAll("${UNIDENTIFIED_PRECISION}", "'coarse_10km'");
  })();

  test("the statements run are the worker's", () => {
    assert.doesNotMatch(giveUp, /\$\{/);
    assert.doesNotMatch(sweep, /\$\{/);
  });

  test("a model that refused the photo, or ran out of attempts, leaves it held", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const r = await held(tx, cat.id);
      await tx.unsafe(giveUp, [r.id]);
      const after_ = await state(tx, r.id);
      assert.equal(after_.held, true);
      assert.equal(after_.location_precision, "coarse_10km");
      assert.equal(after_.status, "published", "a model outage pulled a record off the map");
    });
  });

  test("and so does a job abandoned during its last attempt", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const r = await held(tx, cat.id);
      await tx`insert into classification_jobs (report_id, status, attempts, updated_at)
               values (${r.id}::uuid, 'running', 5, now() - interval '1 hour')`;
      await tx.unsafe(sweep);
      const after_ = await state(tx, r.id);
      assert.equal(after_.held, true);
      assert.equal(after_.location_precision, "coarse_10km");
    });
  });

  test("nothing but a finished classification releases it", () => {
    const writers = [];
    const walk = (dir) => {
      for (const e of readdirSync(join(WEB, dir), { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /held_for_classification\s*=\s*false/.test(code(read(p))))
          writers.push(p);
      }
    };
    walk("lib");
    walk("app");
    assert.deepEqual(writers.sort(), [
      join("lib", "report", "classificationHold.ts"),
      join("lib", "report", "classifyEvidence.ts"),
      join("lib", "report", "classifyWorker.ts"),
    ]);
  });
});

describe("never looser than the species' rule, at any step", () => {
  test("for every rule, and every answer the model can give", async () => {
    await inRollback(async (tx) => {
      const species = [
        await row(tx),
        await row(tx, { protectedStatus: "II" }),
        await row(tx, { sensitivity: "重度" }),
        await row(tx, { sensitivity: "座標不開放" }),
      ];
      for (const mine of species) {
        for (const model of [null, ...species]) {
          const r = await held(tx, mine.id);
          const want = stricter(mine.rule, "coarse_10km");
          assert.equal(r.location_precision, want, `held: ${mine.rule}`);
          await classify(tx, r, model && model.id !== mine.id ? model.id : null);
          const after_ = await state(tx, r.id);
          const end = model && model.id !== mine.id ? stricter(mine.rule, model.rule) : mine.rule;
          assert.equal(after_.location_precision, end, `${mine.rule}, model ${model?.rule ?? "agrees"}`);
          assert.ok(RANK[after_.location_precision] >= RANK[mine.rule]);
        }
      }
    });
  });

  test("and the release clears no override, the hold's own level included", async () => {
    // A moderator's 10 km on a named record is a decision, and the same value
    // as the hold: it must survive the release.
    await inRollback(async (tx) => {
      const cat = await row(tx);
      for (const override of ["coarse_10km", "coarse_50km"]) {
        const r = await held(tx, cat.id, override);
        await classify(tx, r, null);
        const after_ = await state(tx, r.id);
        assert.equal(after_.held, false);
        assert.equal(after_.precision_override, override);
        assert.equal(after_.location_precision, override);
      }
    });
  });

  test("a record its rating left blurred harder keeps that blur when released", async () => {
    // The rating is withdrawn while the record is held; the re-blur never
    // loosens, so the record still has the 50 km it was filed at.
    await inRollback(async (tx) => {
      const once = await row(tx, { sensitivity: "重度" });
      const r = await held(tx, once.id);
      await tx`update taxa set sensitivity = null where id = ${once.id}`;
      assert.equal((await state(tx, r.id)).location_precision, "coarse_50km");
      await classify(tx, r, null);
      const after_ = await state(tx, r.id);
      assert.equal(after_.held, false);
      assert.equal(after_.location_precision, "coarse_50km", "the release loosened a withdrawn rating's blur");
    });
  });

  test("renaming a held record keeps the hold; only the classifier releases it", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const dog = await row(tx);
      const r = await held(tx, cat.id);
      await tx`update reports set taxon_id = ${dog.id}, taxon_source = 'expert' where id = ${r.id}`;
      const after_ = await state(tx, r.id);
      assert.equal(after_.held, true);
      assert.equal(after_.location_precision, "coarse_10km");
    });
  });

  test("a record classified before the hold existed is not written", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const r = await insertReport(tx, { taxonId: cat.id });
      await tx`update reports set taxon_source = 'user' where id = ${r.id}`;
      // Every update writes a new row version, so its ctid says whether one was written.
      const at = async () => (await tx`select ctid::text from reports where id = ${r.id}`)[0].ctid;
      const before = await at();
      await settleClassificationHold(tx, r.id, null, cat.id);
      assert.equal(await at(), before, "the release wrote to a record that was not held");
    });
  });
});

describe("over HTTP, as a reporter files it", () => {
  // The route, the trigger and a real photo in local Storage. Skipped where
  // there is no server or no Storage, as in CI.
  const up = () => fetch(`${BASE_URL}/api/health`).then((r) => r.ok, () => false);
  const storageUp = () =>
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/version`).then((r) => r.ok, () => false);

  async function photo() {
    const res = await fetch(`${BASE_URL}/api/uploads/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 1, contentType: "image/webp" }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const [{ path, token }] = (await res.json()).uploads;
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { error } = await client.storage
      .from("report-photos")
      .uploadToSignedUrl(path, token, new Blob([new Uint8Array(64).fill(7)], { type: "image/webp" }));
    assert.equal(error, null, String(error?.message));
    uploaded.push(path);
    return path;
  }

  async function submit(body) {
    await sql`delete from rate_limits where key like 'submit-%' or key like 'sign-%'`;
    const clientNonce = randomUUID();
    nonces.push(clientNonce);
    // Filed as roadkill, and deleted as soon as it has been read: a published
    // live sighting would be in the wildlife collection, which tiles.test.mjs
    // expects to be empty while the suite runs its files side by side.
    const res = await fetch(`${BASE_URL}/api/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: "roadkill", page: "roadkill", lng: 120.9, lat: 23.8,
        observedAt: new Date().toISOString(), clientNonce, notes: "by the 23 km marker",
        ...body,
      }),
    });
    try {
      const [stored] = await sql`
        select r.id, r.status, r.held_for_classification as held, r.location_precision,
               r.precision_override,
               (select count(*)::int from classification_jobs j where j.report_id = r.id) as jobs,
               p.notes as public_notes, p.location_precision as public_precision
          from reports r left join reports_public p on p.id = r.id
         where r.client_nonce = ${clientNonce}`;
      return { res, body: await res.json(), stored };
    } finally {
      await sql`delete from reports where client_nonce = ${clientNonce}`;
    }
  }

  const species = () =>
    sql`select id from taxa
         where taxon_status = 'accepted' and kingdom = 'Animalia' and rank = 'Species'
           and is_in_taiwan and sensitivity is null and protected_status is null
           and taxon_precision(id) = 'exact'
         order by id limit 1`.then((r) => r[0].id);

  test("named, with a photo: published, held at 10 km, its notes withheld", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    if (!(await storageUp())) return t.skip("no local Storage");
    const { res, body, stored } = await submit({ taxonId: await species(), photoPaths: [await photo()] });
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(stored.status, "published");
    assert.equal(stored.held, true);
    assert.equal(stored.location_precision, "coarse_10km");
    assert.equal(stored.precision_override, null, "the hold was written as an override");
    assert.equal(stored.jobs, 1, "a held report has no job to release it");
    assert.equal(stored.public_precision, "coarse_10km");
    assert.equal(stored.public_notes, null);
  });

  test("named, without a photo: nothing to wait for, so not held", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const { res, body, stored } = await submit({ taxonId: await species(), photoPaths: [] });
    assert.ok(res.status === 201, JSON.stringify(body));
    assert.equal(stored.held, false);
    assert.equal(stored.location_precision, "exact");
    assert.equal(stored.jobs, 0);
  });
});
