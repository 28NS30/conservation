/**
 * Published records that carry a flag.
 *
 * The classifier publishes some records with a flag: one it could only
 * suggest a species for, published unidentified, and one whose reporter and
 * model, sure of itself, name different species, blurred at least as the
 * model's species. Nothing showed those flags until the moderation queue
 * listed them, with an OK that clears one.
 * OK must clear the flag and nothing else: "I looked" is not a decision to
 * publish a location more exactly.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback, insertReport } from "./helpers.mjs";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const ACTIONS = read("app", "[locale]", "(site)", "admin", "actions.ts");
const PAGE = read("app", "[locale]", "(site)", "admin", "page.tsx");

/** One exported action's body. */
const action = (name) => {
  const from = ACTIONS.slice(ACTIONS.indexOf(`export async function ${name}(`));
  const next = from.indexOf("\nexport ", 1);
  return next === -1 ? from : from.slice(0, next);
};

let seq = 0;
const name = () => `Testudofixtura f${process.pid}x${Date.now()}x${seq++}`;

describe("OK on a flagged record", () => {
  const ok = action("clearFlag");

  test("only a moderator, only a published record with a flag", () => {
    assert.match(ok, /await requireModerator\(\)/);
    assert.match(ok, /status = 'published'\s+and flagged_reason is not null/);
    assert.match(ok, /if \(!row\) throw/);
  });

  test("clears the flag and writes nothing else", () => {
    const writes = [...ok.matchAll(/update reports\s+set ([^\n]*)/g)].map((m) => m[1]);
    assert.deepEqual(writes, ["flagged_reason = null where id = ${reportId}::uuid`;"]);
    assert.doesNotMatch(ok, /precision_override|taxon_id\s*=|status\s*=\s*'(?!published)/);
  });

  test("and keeps the reason it cleared in the log", () => {
    assert.match(ok, /'flag',\s*\$\{`cleared: \$\{row\.flagged_reason\}`\.slice\(0, 500\)\}/);
  });

  test("the log takes 'flag' as an action, without a migration", async () => {
    await inRollback(async (tx) => {
      const r = await insertReport(tx);
      await tx`insert into moderation_actions (report_id, action, reason)
               values (${r.id}::uuid, 'flag', 'cleared: the model and the reporter name different species')`;
    });
  });

  test("clearing a flag moves no point", async () => {
    // flagged_reason is not one of the blur trigger's columns, so the record
    // keeps its blur and its public point exactly.
    await inRollback(async (tx) => {
      const [t] = await tx`
        insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan, taxon_status, protected_status)
        values (${`test-fr-${process.pid}-${seq++}`}, ${name()}, 'Species', true, 'accepted', 'II')
        returning id`;
      const r = await insertReport(tx, { taxonId: t.id });
      await tx`update reports set flagged_reason = 'the model and the reporter name different species'
                where id = ${r.id}`;
      await tx`update reports set flagged_reason = null where id = ${r.id}`;
      const [after_] = await tx`
        select location_precision, st_x(location_public::geometry) as lng,
               st_y(location_public::geometry) as lat
          from reports where id = ${r.id}`;
      assert.equal(after_.location_precision, "coarse_10km");
      assert.equal(after_.lng, r.pub_lng);
      assert.equal(after_.lat, r.pub_lat);
    });
  });
});

describe("the queue lists published records with a flag", () => {
  test("below the held reports, and only published ones", () => {
    assert.match(PAGE, /where r\.status = 'published'\s+and r\.flagged_reason is not null/);
    assert.ok(
      PAGE.indexOf("<ModerationRow") < PAGE.indexOf("<FlaggedRow"),
      "the flagged list must come after the held reports",
    );
  });

  test("the whole count is shown, not only what fits", () => {
    assert.match(PAGE, /select count\(\*\)::int as flagged from reports\s+where status = 'published' and flagged_reason is not null/);
    assert.match(PAGE, /t\("flagged\.count", \{ count: flagged \}\)/);
  });
});
