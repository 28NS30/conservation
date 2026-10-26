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

describe("a record held for good is listed, and says so", () => {
  // A named record whose photo the model never answered for stays at 10 km
  // and off the map (lib/report/classificationHold.ts). The give-up paths
  // flag it, so it is listed here; the row must say what holds it, offer to
  // have the model try again, and not let OK read as letting it go.
  const ROW = read("components", "admin", "FlaggedRow.tsx");
  const catalogue = (l) => JSON.parse(read("messages", `${l}.json`)).admin.flagged;

  test("the list knows which records are held", () => {
    assert.match(PAGE, /r\.held_for_classification as held,/);
    assert.match(PAGE, /r\.held && r\.flagged_reason === UNAVAILABLE_FLAG\s*\?\s*t\("flagged\.heldUnavailable"\)/);
    assert.match(PAGE, /held=\{r\.held\}/);
  });

  test("a held row offers classify again, and an OK that keeps the blur", () => {
    assert.match(ROW, /\{props\.held && \(\s*<button[\s\S]*?act\(classifyAgain, "requeued"\)[\s\S]*?t\("flagged\.classifyAgain"\)/);
    assert.match(ROW, /props\.held \? t\("flagged\.okHeld"\) : t\("flagged\.ok"\)/);
    assert.match(ROW, /props\.held\s*\?\s*t\("flagged\.clearedHeld"\)/);
  });

  test("its words say it stays blurred and off the map, in both languages", () => {
    const en = catalogue("en");
    const zh = catalogue("zh-TW");
    for (const key of ["heldUnavailable", "requeued", "clearedHeld"]) {
      assert.match(en[key], /10 km/, `en ${key}`);
      assert.match(en[key], /off the map/, `en ${key}`);
      assert.match(zh[key], /10 公里/, `zh-TW ${key}`);
      assert.match(zh[key], /不會出現在地圖上/, `zh-TW ${key}`);
    }
    assert.match(en.okHeld, /10 km/);
    assert.match(zh.okHeld, /10 公里/);
    for (const key of ["okHeld", "clearedHeld", "requeued"]) {
      assert.doesNotMatch(en[key], /releas|exact|unblur|on the map now/i, `en ${key} suggests the hold is released`);
      assert.doesNotMatch(zh[key], /解除|精確/, `zh-TW ${key} suggests the hold is released`);
    }
    // And the list's own description no longer says every record on it is on the map.
    assert.doesNotMatch(en.body, /on the map but/);
    assert.match(en.body, /Classify again/);
  });
});
