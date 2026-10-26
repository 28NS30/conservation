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
import { UNIDENTIFIED_PRECISION } from "@conservation/shared";
import { BASE_URL, sql, inRollback, insertReport, requireServer } from "./helpers.mjs";
import {
  UNAVAILABLE_FLAG,
  flagHeldAbandoned,
  flagHeldUnclassified,
  flagWhenPublished,
  recordBesidePerson,
  requeueClassification,
  settleClassificationHold,
} from "../lib/report/classificationHold.ts";

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const WORKER = read("lib", "report", "classifyWorker.ts");
const EVIDENCE = read("lib", "report", "classifyEvidence.ts");
const ROUTE = read("app", "api", "reports", "route.ts");
const TILES = read("app", "api", "tiles", "[z]", "[x]", "[y]", "route.ts");
const ADMIN = read("app", "[locale]", "(site)", "admin", "actions.ts");
const CONFIRM = read("app", "[locale]", "(site)", "reports", "[id]", "actions.ts");
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
after(async () => {
  if (nonces.length) await sql`delete from reports where client_nonce = any(${nonces})`;
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
    returning id, taicol_id, scientific_name`;
  // Asked after the insert: RETURNING runs on a snapshot without the new row.
  const [{ rule }] = await tx`select taxon_precision(${t.id}) as rule`;
  return { ...t, rule: rule ?? "exact" };
}

/**
 * A report its reporter named with a photo, inserted held as POST /api/reports
 * inserts one; or, with `isHeld` false, its twin filed before the hold existed.
 */
async function held(tx, taxonId, override = null, isHeld = true) {
  const [{ id }] = await tx`
    insert into reports (category, location, location_public, observed_at, taxon_id,
                         taxon_source, status, source, precision_override,
                         held_for_classification)
    values ('roadkill',
            st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
            st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
            now(), ${taxonId}, 'user', 'published', 'user', ${override}, ${isHeld})
    returning id`;
  return { ...(await state(tx, id)), id, taxonId };
}

/** A row sharing `species`' binomial: a subspecies of it, unrated. */
async function sibling(tx, species) {
  const [t] = await tx`
    insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan, taxon_status)
    values (${`${species.taicol_id}-ssp`}, ${`${species.scientific_name} formosana`},
            'Subspecies', true, 'accepted')
    returning id, taicol_id`;
  return t;
}
const state = async (tx, id) =>
  (await tx`select taxon_id, precision_override, location_precision,
                   held_for_classification as held, held_rule_precision as decided,
                   status, flagged_reason
              from reports where id = ${id}`)[0];
/**
 * The classifier's record branch, the model's answer being `model`, for the
 * job as the worker claims it: with the record's name and its source then.
 */
const classify = async (tx, r, model = null) => {
  const [claim] = await tx`select taxon_id, taxon_source from reports where id = ${r.id}`;
  return recordBesidePerson(tx, {
    reportId: r.id,
    claimedTaxonId: claim.taxon_id,
    claimedSource: claim.taxon_source,
    score: 0.97,
    band: "high",
    disagreeingTaxonId: model,
  });
};

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
      /p := stricter_precision\(free, case when new\.held_for_classification then 'coarse_10km' end\);/,
    );
    assert.match(MIGRATION, /free := report_precision\(new\.taxon_id, new\.precision_override\);/);
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

describe("released even when a person renamed it while the model ran", () => {
  // The assign and suggest branches write only if nobody named the record
  // between the claim and the write. When somebody did, nothing was written,
  // the job was marked done, and a hold the record was filed under stayed for
  // good, flagged by nothing and listed nowhere. The model has looked; the
  // hold is released, as the record branch releases it.
  test("both workers release the hold when their guarded write finds no row", () => {
    for (const [name, src] of [["classifyWorker.ts", code(WORKER)], ["classifyEvidence.ts", code(EVIDENCE)]]) {
      const n = (src.match(/if \(written\.count === 0\) await settleClassificationHold\(tx, job\.report_id, null, null\);/g) ?? []).length;
      assert.equal(n, 2, `${name}: the assign and suggest branches`);
    }
  });

  test("released without the model's blur, to the blur the new name decides", async () => {
    await inRollback(async (tx) => {
      const owl = await row(tx, { sensitivity: "重度" });
      const cat = await row(tx);
      const r = await held(tx, cat.id);
      // Un-named by a moderator before the claim, named again during the run.
      await tx`update reports set taxon_id = null, taxon_source = 'expert' where id = ${r.id}`;
      await tx`update reports set taxon_id = ${owl.id}, taxon_source = 'expert' where id = ${r.id}`;
      await settleClassificationHold(tx, r.id, null, null);
      const now = await state(tx, r.id);
      assert.equal(now.held, false);
      assert.equal(now.location_precision, "coarse_50km");
    });
  });
});

describe("held when the classifier fails", () => {
  // Both give-up paths of the worker, read out of the source and run as
  // written: the job's own, and the sweep that retires a job which died
  // during its last attempt. Neither blurs nor unpublishes a published
  // record; each flags a held one, by a statement of its own.
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

  test("a model that refused the photo, or ran out of attempts, leaves it held, and flagged", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const r = await held(tx, cat.id);
      await tx.unsafe(giveUp, [r.id]);
      await flagHeldUnclassified(tx, r.id);
      const after_ = await state(tx, r.id);
      assert.equal(after_.held, true);
      assert.equal(after_.location_precision, "coarse_10km");
      assert.equal(after_.status, "published", "a model outage pulled a record off the map");
      assert.equal(after_.precision_override, null, "the flag wrote a blur of its own");
      assert.equal(after_.flagged_reason, UNAVAILABLE_FLAG, "held for good, and nobody told");
    });
  });

  test("and so does a job abandoned during its last attempt", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const r = await held(tx, cat.id);
      await tx`insert into classification_jobs (report_id, status, attempts, updated_at)
               values (${r.id}::uuid, 'running', 5, now() - interval '1 hour')`;
      // In the worker's order: the flag by the sweep's own test, then the sweep.
      await flagHeldAbandoned(tx, 5, "5 minutes");
      await tx.unsafe(sweep);
      const after_ = await state(tx, r.id);
      assert.equal(after_.held, true);
      assert.equal(after_.location_precision, "coarse_10km");
      assert.equal(after_.status, "published");
      assert.equal(after_.flagged_reason, UNAVAILABLE_FLAG);
      const [job] = await tx`select status from classification_jobs where report_id = ${r.id}::uuid`;
      assert.equal(job.status, "failed", "the sweep did not retire the job");
    });
  });

  test("both paths call the flag, in their own statements", () => {
    const src = code(WORKER);
    const branch = src.slice(src.indexOf("if (giveUp) {"), src.indexOf("console.error(`[jobs/classify]"));
    assert.match(branch, /and status = 'pending'`;\s*await flagHeldUnclassified\(tx, job\.report_id\);/,
      "the give-up branch must flag a held record after the pending report's statement");
    assert.match(
      src,
      /await sql\.begin\(async \(tx\) => \{\s*await flagHeldAbandoned\(tx, MAX_ATTEMPTS, STALE_AFTER\);\s*await tx`\s*with stuck as \(/,
      "the sweep must flag first, in the same transaction, before it retires the jobs",
    );
  });

  test("the flag touches no record but a published one that is held", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const free = await held(tx, cat.id, null, false);
      const pending = await held(tx, cat.id);
      await tx`update reports set status = 'pending' where id = ${pending.id}`;
      for (const r of [free, pending]) {
        await tx`insert into classification_jobs (report_id, status, attempts, updated_at)
                 values (${r.id}::uuid, 'running', 5, now() - interval '1 hour')`;
        await flagHeldUnclassified(tx, r.id);
      }
      await flagHeldAbandoned(tx, 5, "5 minutes");
      assert.equal((await state(tx, free.id)).flagged_reason, null, "a record that is not held");
      assert.equal((await state(tx, pending.id)).flagged_reason, null, "a pending one is the other statement's");
    });
  });

  test("a job still being worked on, or not stale yet, is not flagged", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const r = await held(tx, cat.id);
      await tx`insert into classification_jobs (report_id, status, attempts, updated_at)
               values (${r.id}::uuid, 'running', 5, now())`;
      await flagHeldAbandoned(tx, 5, "5 minutes");
      assert.equal((await state(tx, r.id)).flagged_reason, null);
    });
  });

  describe("a named report the abuse screen held as well", () => {
    // Filed named, with a photo and a link in its notes: pending for a
    // moderator, and held for the model. The give-up stamped it with the
    // unidentified 10 km, which a later release read as a decision; and the
    // moderator's publish cleared its flag, so the record was published, held
    // for good, off the map, in no list and with no way to classify it again.
    async function screened(tx, taxonId, jobStatus = "running") {
      const r = await held(tx, taxonId);
      await tx`update reports set status = 'pending', flagged_reason = 'links or handles in notes'
                where id = ${r.id}`;
      if (jobStatus)
        await tx`insert into classification_jobs (report_id, status, attempts, updated_at)
                 values (${r.id}::uuid, ${jobStatus}, 5, now() - interval '1 hour')`;
      return r;
    }
    /** publishReport's statement, as admin/actions.ts writes it. */
    const publish = (tx, r) =>
      tx`update reports set status = 'published', flagged_reason = ${flagWhenPublished(tx)}
          where id = ${r.id}::uuid and status = 'pending'
          returning id`;

    test("publishReport writes its flag through the fragment", () => {
      assert.match(
        code(ADMIN),
        /update reports set status = 'published', flagged_reason = \$\{flagWhenPublished\(tx\)\}\s*where id = \$\{reportId\}::uuid and status = 'pending'/,
      );
    });

    test("given up, then published: flagged for the model, and released exact once it answers", async () => {
      await inRollback(async (tx) => {
        const myna = await row(tx, { invasive: true });
        const r = await screened(tx, myna.id);
        // The job's own give-up, as the worker writes it.
        await tx`update classification_jobs set status = 'failed' where report_id = ${r.id}::uuid`;
        await tx.unsafe(giveUp, [r.id]);
        await flagHeldUnclassified(tx, r.id);
        let now = await state(tx, r.id);
        assert.equal(now.precision_override, null, "the give-up stamped a named, held report");
        assert.equal(now.location_precision, "coarse_10km", "the hold blurs it");
        assert.equal(now.flagged_reason, "links or handles in notes");

        assert.equal((await publish(tx, r)).length, 1);
        now = await state(tx, r.id);
        assert.equal(now.status, "published");
        assert.equal(now.held, true);
        assert.equal(now.flagged_reason, UNAVAILABLE_FLAG, "published held for good, and in no list");
        assert.deepEqual(await requeueClassification(tx, r.id), { flaggedReason: UNAVAILABLE_FLAG });

        await classify(tx, r, null);
        now = await state(tx, r.id);
        assert.equal(now.held, false);
        assert.equal(now.location_precision, "exact", "a named invasive species kept from its exact spot");
      });
    });

    test("and the same after the sweep retires a job abandoned on its last attempt", async () => {
      await inRollback(async (tx) => {
        const myna = await row(tx, { invasive: true });
        const r = await screened(tx, myna.id);
        await flagHeldAbandoned(tx, 5, "5 minutes");
        await tx.unsafe(sweep);
        assert.equal((await state(tx, r.id)).precision_override, null, "the sweep stamped it");
        await publish(tx, r);
        assert.equal((await state(tx, r.id)).flagged_reason, UNAVAILABLE_FLAG);
      });
    });

    test("with no job, or one marked done, it is flagged too; with one still to run, not", async () => {
      await inRollback(async (tx) => {
        const cat = await row(tx);
        for (const [job, flag] of [[null, UNAVAILABLE_FLAG], ["done", UNAVAILABLE_FLAG],
                                   ["queued", null], ["running", null]]) {
          const r = await screened(tx, cat.id, job);
          await publish(tx, r);
          assert.equal((await state(tx, r.id)).flagged_reason, flag, `job ${job}`);
        }
        // Not held: published as it always was, its flag answered.
        const free = await held(tx, cat.id, null, false);
        await tx`update reports set status = 'pending', flagged_reason = 'links or handles in notes'
                  where id = ${free.id}`;
        await publish(tx, free);
        assert.equal((await state(tx, free.id)).flagged_reason, null);
      });
    });

    test("an unnamed report is still stamped and flagged by both give-up paths", async () => {
      await inRollback(async (tx) => {
        for (const path of ["giveUp", "sweep"]) {
          const r = await insertReport(tx, { taxonId: null, status: "pending" });
          // And one a moderator un-named while it was held: the name is what
          // the hold stood in for.
          const cat = await row(tx);
          const unnamed = await held(tx, cat.id);
          await tx`update reports set status = 'pending', taxon_id = null where id = ${unnamed.id}`;
          for (const x of [r, unnamed]) {
            await tx`update reports set precision_override = null where id = ${x.id}`;
            await tx`insert into classification_jobs (report_id, status, attempts, updated_at)
                     values (${x.id}::uuid, 'running', 5, now() - interval '1 hour')`;
          }
          if (path === "giveUp") for (const x of [r, unnamed]) await tx.unsafe(giveUp, [x.id]);
          else await tx.unsafe(sweep);
          for (const x of [r, unnamed]) {
            const now = await state(tx, x.id);
            assert.equal(now.precision_override, "coarse_10km", `${path}: the unidentified stamp`);
            assert.equal(now.flagged_reason, UNAVAILABLE_FLAG, path);
          }
        }
      });
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

describe("a moderator can have the model try again", () => {
  /** A held record the worker gave up on, as the give-up path leaves it. */
  async function givenUp(tx) {
    const cat = await row(tx);
    const r = await held(tx, cat.id);
    await tx`insert into classification_jobs (report_id, status, attempts, last_error)
             values (${r.id}::uuid, 'failed', 5, 'the model refused the photo')`;
    await flagHeldUnclassified(tx, r.id);
    return r;
  }
  const job = async (tx, id) =>
    Array.from(
      await tx`select status, attempts, last_error from classification_jobs
                where report_id = ${id}::uuid order by id`,
      ({ status, attempts, last_error }) => ({ status, attempts, last_error }),
    );

  test("its job goes back in the queue, as new, and the hold stays", async () => {
    await inRollback(async (tx) => {
      const r = await givenUp(tx);
      const queued = await requeueClassification(tx, r.id);
      assert.deepEqual(queued, { flaggedReason: UNAVAILABLE_FLAG });
      assert.deepEqual(await job(tx, r.id), [{ status: "queued", attempts: 0, last_error: null }]);
      const after_ = await state(tx, r.id);
      assert.equal(after_.held, true, "classify again released the hold");
      assert.equal(after_.location_precision, "coarse_10km");
      assert.equal(after_.precision_override, null);
      assert.equal(after_.status, "published");
      assert.equal(after_.flagged_reason, null, "the give-up's flag outlived the requeue");
      // And the worker's claim takes it: queued, with attempts to spare.
      const claim = /where \(\s*j\.status in \('queued','failed'\)/.test(WORKER);
      assert.ok(claim, "the claim no longer takes queued jobs");
    });
  });

  test("a second click, while the job waits, queues nothing", async () => {
    await inRollback(async (tx) => {
      const r = await givenUp(tx);
      await requeueClassification(tx, r.id);
      assert.equal(await requeueClassification(tx, r.id), null);
      assert.equal((await job(tx, r.id)).length, 1);
    });
  });

  test("a record no longer held, or not published, is refused", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const free = await held(tx, cat.id, null, false);
      await tx`insert into classification_jobs (report_id, status, attempts)
               values (${free.id}::uuid, 'failed', 5)`;
      assert.equal(await requeueClassification(tx, free.id), null);
      const rejected = await givenUp(tx);
      await tx`update reports set status = 'rejected' where id = ${rejected.id}`;
      assert.equal(await requeueClassification(tx, rejected.id), null);
      assert.equal((await job(tx, free.id))[0].status, "failed", "the refused job was queued");
    });
  });

  test("a held record with no job is given one, and another flag is kept", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const r = await held(tx, cat.id);
      await tx`update reports set flagged_reason = 'links or handles in notes' where id = ${r.id}`;
      assert.deepEqual(await requeueClassification(tx, r.id), { flaggedReason: "links or handles in notes" });
      assert.deepEqual(await job(tx, r.id), [{ status: "queued", attempts: 0, last_error: null }]);
      assert.equal((await state(tx, r.id)).flagged_reason, "links or handles in notes");
    });
  });

  test("the action is a moderator's, logged, and releases nothing", () => {
    const from = ADMIN.indexOf("export async function classifyAgain(");
    assert.ok(from > 0, "no classifyAgain action");
    const rest = ADMIN.slice(from);
    const end = rest.indexOf("\nexport ", 1);
    const body = end === -1 ? rest : rest.slice(0, end);
    assert.match(body, /const actor = await requireModerator\(\);/);
    assert.match(body, /await sql\.begin\(async \(tx\) => \{\s*const queued = await requeueClassification\(tx, reportId\);/);
    assert.match(body, /if \(!queued\) throw/);
    assert.match(body, /insert into moderation_actions \(report_id, actor_id, action, reason\)[\s\S]*'flag'/);
    assert.doesNotMatch(code(body), /held_for_classification|precision_override|status\s*=/);
  });
});

describe("a tightening while it is held outlives the hold", () => {
  // A row sharing the record's binomial is given a floor or a rating while
  // the record is held. tighten_binomial_siblings() writes the binomial's
  // blur as an override where it is stricter than the record's, and used to
  // compare with the hold's 10 km: a 10 km rule wrote nothing, and the release
  // put the record at its own rule for good, beside an unheld twin at 10 km.
  for (const [what, add] of [
    ["a 10 km floor", (tx, sib) =>
      tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
         values (${sib.taicol_id}, 'coarse_10km', 'test')`],
    ["a 10 km rating", (tx, sib) =>
      tx`update taxa set sensitivity = '輕度' where id = ${sib.id}`],
  ]) {
    test(`${what} on a sibling keeps the record at 10 km after the release`, async () => {
      await inRollback(async (tx) => {
        const cat = await row(tx);
        const sib = await sibling(tx, cat);
        const r = await held(tx, cat.id);
        const twin = await held(tx, cat.id, null, false);
        assert.equal(twin.location_precision, "exact");
        await add(tx, sib);
        assert.equal((await state(tx, twin.id)).location_precision, "coarse_10km", "fixture: the twin tightened");
        assert.equal((await state(tx, r.id)).precision_override, "coarse_10km", "the hold masked the tightening");
        await classify(tx, r, null);
        const after_ = await state(tx, r.id);
        assert.equal(after_.held, false);
        assert.equal(after_.location_precision, "coarse_10km", "released below its sibling's rule");
      });
    });
  }

  test("and a floor stricter than 10 km does the same", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const sib = await sibling(tx, cat);
      const r = await held(tx, cat.id);
      await tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
               values (${sib.taicol_id}, 'coarse_50km', 'test')`;
      assert.equal((await state(tx, r.id)).location_precision, "coarse_50km");
      await classify(tx, r, null);
      const after_ = await state(tx, r.id);
      assert.equal(after_.held, false);
      assert.equal(after_.location_precision, "coarse_50km");
      assert.equal(after_.precision_override, "coarse_50km");
    });
  });

  test("a record held harder than the hold is never loosened by it", async () => {
    // Its 50 km rating is withdrawn while it is held, which leaves it at 50 km
    // (tighten_reports never loosens), and then a sibling is floored at 10 km.
    // Compared with the record's own rule alone, exact, the floor would be
    // written, and the trigger would re-derive the record to 10 km.
    await inRollback(async (tx) => {
      const owl = await row(tx, { sensitivity: "重度" });
      const sib = await sibling(tx, owl);
      const r = await held(tx, owl.id);
      await tx`update taxa set sensitivity = null where id = ${owl.id}`;
      assert.equal((await state(tx, r.id)).location_precision, "coarse_50km");
      await tx`insert into taxon_precision_floors (taicol_id, min_precision, reason)
               values (${sib.taicol_id}, 'coarse_10km', 'test')`;
      assert.equal((await state(tx, r.id)).location_precision, "coarse_50km", "the floor loosened a held record");
      await classify(tx, r, null);
      assert.equal((await state(tx, r.id)).location_precision, "coarse_50km");
    });
  });
});

describe("released where a twin that was never held would be", () => {
  // A record's blur only tightens between renames: tighten_reports() never
  // loosens, so a record whose 10 km rule is withdrawn keeps 10 km until a
  // rename re-derives it. The hold masked that. A held record sat at 10 km,
  // so a 10 km rule it was filed under, or was given during the hold, looked
  // like the hold, and the release re-derived the record from the rules of
  // the moment: withdrawn by then, the rule was lost and the record was exact,
  // beside a twin that was never held at 10 km. The trigger now keeps the blur
  // the record would have without the hold (held_rule_precision, 0033), and
  // the release puts it there. Each case below does the same things to a
  // held record and to its twin, has the classifier run on both, as it does
  // on every named report with a photo, and asks that they end alike.
  async function withTwin(tx, taxonId, during, model = null) {
    const r = await held(tx, taxonId);
    const twin = await held(tx, taxonId, null, false);
    await during?.(tx, [r, twin]);
    await classify(tx, r, model);
    await classify(tx, twin, model);
    const ends = async (id) => {
      const x = await state(tx, id);
      return { location_precision: x.location_precision, precision_override: x.precision_override };
    };
    const [h, t] = [await state(tx, r.id), await state(tx, twin.id)];
    assert.equal(h.held, false);
    assert.equal(h.decided, null, "the blur beside the hold outlived it");
    assert.equal(t.decided, null, "a record never held carries a blur beside a hold");
    const [a, b] = [await ends(r.id), await ends(twin.id)];
    assert.deepEqual(a, b, "the held record and its twin ended apart");
    return a;
  }
  const withdraw = (tx, t) =>
    tx`update taxa set sensitivity = null, protected_status = null, rank = 'Species' where id = ${t.id}`;
  /** A moderator naming the species, as setReportTaxon writes it. */
  const rename = (tx, ids, to) =>
    tx`update reports
          set taxon_id = ${to.id}, taxon_source = 'expert',
              precision_override = stricter_precision(
                case when taxon_id is null
                     then case when precision_rank(precision_override) > precision_rank('coarse_10km')
                               then precision_override end
                     else precision_override end,
                binomial_precision_floor(${to.id}))
        where id = any(${ids.map((r) => r.id)}::uuid[])`;

  for (const [what, opts] of [
    ["a 輕度 rating", { sensitivity: "輕度" }],
    ["a class III protection", { protectedStatus: "III" }],
  ]) {
    test(`${what} it was filed under, withdrawn during the hold, still blurs it`, async () => {
      // E3: the record went from 10 km to exact at the release.
      await inRollback(async (tx) => {
        const bird = await row(tx, opts);
        assert.equal(bird.rule, "coarse_10km", "fixture: a 10 km rule");
        const end = await withTwin(tx, bird.id, (tx_) => withdraw(tx_, bird));
        assert.deepEqual(end, { location_precision: "coarse_10km", precision_override: null });
      });
    });
  }

  test("so does the rank rule, a name above the species withdrawn during the hold", async () => {
    await inRollback(async (tx) => {
      const genus = await row(tx);
      await tx`update taxa set rank = 'Genus' where id = ${genus.id}`;
      const end = await withTwin(tx, genus.id, (tx_) => withdraw(tx_, genus));
      assert.equal(end.location_precision, "coarse_10km");
    });
  });

  test("a 10 km rating given during the hold and withdrawn again still blurs it", async () => {
    // E7: unrated at filing, so the rating was no stricter than the hold and
    // re-derived nothing; withdrawn before the release, it was lost.
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const end = await withTwin(tx, cat.id, async (tx_, [r]) => {
        await tx_`update taxa set sensitivity = '輕度' where id = ${cat.id}`;
        assert.equal((await state(tx_, r.id)).decided, "coarse_10km", "the rating did not reach the held record");
        await withdraw(tx_, cat);
      });
      assert.deepEqual(end, { location_precision: "coarse_10km", precision_override: null });
    });
  });

  test("and so does one given to a row sharing its binomial", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const sib = await sibling(tx, cat);
      const end = await withTwin(tx, cat.id, async (tx_) => {
        await tx_`update taxa set sensitivity = '輕度' where id = ${sib.id}`;
        await tx_`update taxa set sensitivity = null where id = ${sib.id}`;
      });
      assert.deepEqual(end, { location_precision: "coarse_10km", precision_override: "coarse_10km" });
    });
  });

  test("a rename during the hold re-derives it, as it re-derives the twin", async () => {
    // The 10 km kept from a withdrawn rating is not a decision; a moderator's
    // naming is one, and it re-derives a record from the new name's rules.
    await inRollback(async (tx) => {
      const bird = await row(tx, { sensitivity: "輕度" });
      const dog = await row(tx);
      const rated = await row(tx, { sensitivity: "輕度" });
      const toDog = await withTwin(tx, bird.id, async (tx_, both) => {
        await withdraw(tx_, bird);
        await rename(tx_, both, dog);
      });
      assert.deepEqual(toDog, { location_precision: "exact", precision_override: null });
      const toRated = await withTwin(tx, bird.id, (tx_, both) => rename(tx_, both, rated));
      assert.equal(toRated.location_precision, "coarse_10km");
      // And a rule the new name is given during the hold is kept like any other.
      const later = await row(tx);
      const ratedLater = await withTwin(tx, bird.id, async (tx_, both) => {
        await rename(tx_, both, later);
        await tx_`update taxa set sensitivity = '輕度' where id = ${later.id}`;
        await withdraw(tx_, later);
      });
      assert.equal(ratedLater.location_precision, "coarse_10km");
    });
  });

  test("a reporter's second pick during the hold keeps the blur the twin keeps, not the hold's", async () => {
    // confirmSpecies keeps at least the blur a re-picked record has. Read as
    // location_precision, that was the hold's 10 km, written as an override:
    // the record stayed at 10 km for good, a named invasive species with it.
    await inRollback(async (tx) => {
      const cat = await row(tx, { invasive: true });
      const other = await row(tx, { invasive: true });
      const end = await withTwin(tx, cat.id, (tx_, both) =>
        tx_`update reports
               set taxon_id = ${other.id}, taxon_source = 'user',
                   precision_override = stricter_precision(
                     stricter_precision(precision_override, binomial_precision_floor(${other.id})),
                     coalesce(held_rule_precision, location_precision))
             where id = any(${both.map((r) => r.id)}::uuid[])`,
      );
      assert.equal(end.location_precision, "exact", "the hold became a decision");
    });
    assert.match(
      code(CONFIRM),
      /\? sql`stricter_precision\(\$\{photoIdentificationOverride\(taxonId\)\},\s*coalesce\(held_rule_precision, location_precision\)\)`/,
      "confirmSpecies no longer keeps the decided blur on a re-pick",
    );
  });

  test("the model's blur is written as on the twin, over a withdrawn rating's blur too", async () => {
    await inRollback(async (tx) => {
      const owl = await row(tx, { sensitivity: "重度" });
      const bird = await row(tx, { sensitivity: "輕度" });
      const leopardCat = await row(tx, { protectedStatus: "I", sensitivity: "重度" });
      // Filed at 50 km, the rating withdrawn: the model's 10 km is looser, and
      // the 50 km is kept beside it.
      const kept = await withTwin(tx, owl.id, (tx_) => withdraw(tx_, owl), bird.id);
      assert.deepEqual(kept, { location_precision: "coarse_50km", precision_override: "coarse_50km" });
      // Rated 10 km during the hold and withdrawn: the model's 50 km is stricter.
      const cat = await row(tx);
      const harder = await withTwin(tx, cat.id, async (tx_) => {
        await tx_`update taxa set sensitivity = '輕度' where id = ${cat.id}`;
        await withdraw(tx_, cat);
      }, leopardCat.id);
      assert.deepEqual(harder, { location_precision: "coarse_50km", precision_override: "coarse_50km" });
    });
  });

  test("while it is held, the blur beside the hold is its rule's, and the public never sees it", async () => {
    await inRollback(async (tx) => {
      const owl = await row(tx, { sensitivity: "重度" });
      const cat = await row(tx);
      assert.equal((await held(tx, owl.id)).decided, "coarse_50km");
      assert.equal((await held(tx, cat.id)).decided, "exact");
      assert.equal((await held(tx, cat.id, null, false)).decided, null);
    });
    for (const view of ["reports_public", "reports_on_map"]) {
      const cols = (await sql`select column_name from information_schema.columns
                               where table_schema = 'public' and table_name = ${view}`)
        .map((c) => c.column_name);
      assert.ok(!cols.includes("held_rule_precision"), `${view} shows the blur beside the hold`);
    }
  });
});

describe("off the map while held", () => {
  // The map's tiles are cached for up to a day where nothing can purge them,
  // and the hold's 10 km can be looser than the model then decides, so the
  // tiles read reports_on_map, which leaves held records out. Its own page
  // still shows a held record.

  test("a held record is public, but not on the map until it is released", async () => {
    await inRollback(async (tx) => {
      const cat = await row(tx);
      const r = await held(tx, cat.id);
      const seen = async () => {
        await tx`set local role web_anon`;
        const [x] = await tx`
          select (select count(*)::int from reports_public where id = ${r.id}) as public,
                 (select count(*)::int from reports_on_map where id = ${r.id}) as map`;
        await tx`reset role`;
        return { public: x.public, map: x.map };
      };
      assert.deepEqual(await seen(), { public: 1, map: 0 });
      await classify(tx, r, null);
      assert.deepEqual(await seen(), { public: 1, map: 1 });
    });
  });

  test("the view shows the public no more than reports_public does", async () => {
    const cols = async (view) =>
      (await sql`select column_name from information_schema.columns
                  where table_schema = 'public' and table_name = ${view}
                  order by ordinal_position`).map((c) => c.column_name);
    assert.deepEqual(await cols("reports_on_map"), await cols("reports_public"));
    const [grant] = await sql`
      select has_table_privilege('web_anon', 'public.reports_on_map', 'select') as web_anon,
             has_table_privilege('web_anon', 'public.reports', 'select') as base,
             (select not has_table_privilege('anon', 'public.reports_on_map', 'select')
                from pg_roles where rolname = 'anon') as closed`;
    assert.equal(grant.web_anon, true, "the tiles' role cannot read the map's view");
    assert.equal(grant.base, false);
    assert.notEqual(grant.closed, false, "the REST API's role can read the map's view");
  });

  test("and so does every other kept list of points, and the export to GBIF", () => {
    // A species page is static until the next deploy, and the lab's ledger
    // and the /stats hotspots are rebuilt every few minutes: a held record's
    // 10 km point kept there could outlive the model's answer as one kept in
    // a tile could. A copy on GBIF outlives everything. The record's own page
    // and the /reports list, read on every request, may show it.
    const body = (src, fn) => {
      const from = src.search(new RegExp(`export (?:async )?function ${fn}\\(`));
      assert.ok(from >= 0, `no ${fn}`);
      const end = src.indexOf("\nexport ", from + 1);
      return code(end === -1 ? src.slice(from) : src.slice(from, end));
    };
    const EXPORT = readFileSync(join(WEB, "..", "..", "scripts", "dwc-occurrences.ts"), "utf8");
    for (const [file, src, fn] of [
      ["lib/species.ts", read("lib", "species.ts"), "recentRecords"],
      ["lib/stats.ts", read("lib", "stats.ts"), "anniversaryLedger"],
      ["lib/stats.ts", read("lib", "stats.ts"), "hotspots"],
    ]) {
      const b = body(src, fn);
      assert.match(b, /from reports_on_map\b/, `${file} ${fn}`);
      assert.doesNotMatch(b, /reports_public/, `${file} ${fn}`);
    }
    const select = code(EXPORT.slice(EXPORT.indexOf("export function selectOccurrences(")));
    assert.match(select.slice(0, select.indexOf("export function", 10)), /from reports_on_map r\b/);

    // And every reader of a record's public point is one of those, or one read
    // on every request, or a count. A new one has to be put in one list or
    // the other.
    const readers = [];
    const walk = (dir) => {
      for (const e of readdirSync(join(WEB, dir), { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /location_public|geom_3857/.test(code(read(p)))) readers.push(p);
      }
    };
    walk("lib");
    walk("app");
    walk("components");
    assert.deepEqual(readers.sort(), [
      join("app", "[locale]", "(site)", "reports", "(list)", "page.tsx"), // per request
      join("app", "[locale]", "(site)", "reports", "[id]", "page.tsx"), // per request
      join("app", "api", "reports", "route.ts"), // writes the point at insert
      join("app", "api", "tiles", "[z]", "[x]", "[y]", "route.ts"), // reports_on_map
      join("lib", "coverage.ts"), // counts squares of exact records; a held one is never exact
      join("lib", "species.ts"), // recentRecords, above
      join("lib", "stats.ts"), // the ledger and the hotspots, above
    ].sort());
  });

  test("every layer of the tile route reads it, and nothing else", () => {
    const src = code(TILES);
    assert.equal((src.match(/from reports_on_map r/g) ?? []).length, 2, "the cells and the points");
    assert.doesNotMatch(src, /reports_public|from reports\b/);
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
  // The route and the trigger together. A named report with a photo is held,
  // and that half needs a photo the route can find in Storage, which CI does
  // not run: it is pinned above in the route's own source and at the insert,
  // and was last run over HTTP against local Storage on 26 October 2026. A
  // report without a photo needs only the server, which CI starts.
  async function submit(body) {
    await sql`delete from rate_limits where key like 'submit-%'`;
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
               r.held_rule_precision as decided,
               (select count(*)::int from classification_jobs j where j.report_id = r.id) as jobs
          from reports r
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

  test("named, without a photo: nothing to wait for, so not held", async (t) => {
    if (!(await requireServer(t))) return;
    const { res, body, stored } = await submit({ taxonId: await species(), photoPaths: [] });
    assert.ok(res.status === 201, JSON.stringify(body));
    assert.equal(stored.held, false);
    assert.equal(stored.decided, null);
    assert.equal(stored.location_precision, "exact");
    assert.equal(stored.jobs, 0);
  });
});
