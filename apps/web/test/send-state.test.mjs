/**
 * Saving on the phone is not sending, and must not wait for what sending needs.
 *
 * The report form's button was disabled until Cloudflare Turnstile produced a
 * token, and Turnstile's script cannot load with no signal — so a report page
 * opened on a mountain road could neither send nor save, which is the one case
 * the offline queue was built for. Production has Turnstile keys; local
 * development and CI have none, so no browser test here can see a challenge
 * that never solves. The decision is therefore a pure function, walked case
 * by case, and the form is pinned to using it.
 *
 *   node --test test/send-state.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  sendControls,
  SEND_PATIENCE_MS,
  TOKEN_PATIENCE_MS,
} from "../lib/report/sendState.ts";

/** A report that is ready in every way except whatever a case changes. */
const ready = {
  online: true,
  turnstileEnabled: true,
  hasToken: true,
  hasLocation: true,
  preparing: false,
  needsCondition: false,
  busy: false,
  tokenSlow: false,
  sendSlow: false,
};

describe("offline", () => {
  test("the main button saves, and needs no challenge to do it", () => {
    const c = sendControls({ ...ready, online: false, hasToken: false });
    assert.equal(c.primary, "save");
    assert.equal(c.disabled, false, "a page opened with no signal could not save");
    assert.equal(c.blocker, null);
  });

  test("it still needs a place, an answer and finished photos", () => {
    assert.equal(
      sendControls({ ...ready, online: false, hasLocation: false }).blocker,
      "needLocation",
    );
    assert.equal(
      sendControls({ ...ready, online: false, needsCondition: true }).blocker,
      "needCondition",
    );
    assert.equal(
      sendControls({ ...ready, online: false, preparing: true }).blocker,
      "preparingPhotos",
    );
    assert.equal(sendControls({ ...ready, online: false, hasLocation: false }).disabled, true);
  });

  test("while saving, it cannot be pressed twice", () => {
    assert.equal(sendControls({ ...ready, online: false, busy: true }).disabled, true);
  });
});

describe("online", () => {
  test("the main button sends, once there is a token", () => {
    const c = sendControls(ready);
    assert.deepEqual(c, { primary: "send", disabled: false, blocker: null, backup: null });
  });

  test("without a token it waits, and says so", () => {
    const c = sendControls({ ...ready, hasToken: false });
    assert.equal(c.disabled, true);
    assert.equal(c.blocker, "needChallenge");
    assert.equal(c.backup, null, "nobody mid-challenge is offered the other path at once");
  });

  test("a deployment with no challenge never waits for one", () => {
    const c = sendControls({ ...ready, turnstileEnabled: false, hasToken: false });
    assert.equal(c.disabled, false);
    assert.equal(c.blocker, null);
  });

  test("a challenge that has not solved in time offers to save instead", () => {
    const c = sendControls({ ...ready, hasToken: false, tokenSlow: true });
    assert.equal(c.backup, "noToken");
    assert.equal(c.primary, "send", "the main button keeps waiting");
    // Once the token arrives, the offer goes: it was about the wait.
    assert.equal(sendControls({ ...ready, tokenSlow: true }).backup, null);
  });

  test("but not before the report itself is complete", () => {
    assert.equal(
      sendControls({ ...ready, hasToken: false, tokenSlow: true, hasLocation: false }).backup,
      null,
    );
  });

  test("a send that has run too long offers to save instead", () => {
    const sending = sendControls({ ...ready, busy: true });
    assert.equal(sending.disabled, true);
    assert.equal(sending.backup, null);
    assert.equal(sendControls({ ...ready, busy: true, sendSlow: true }).backup, "slow");
  });

  test("the first thing missing is named, in the order someone meets them", () => {
    const all = { ...ready, preparing: true, needsCondition: true, hasLocation: false, hasToken: false };
    assert.equal(sendControls(all).blocker, "preparingPhotos");
    assert.equal(sendControls({ ...all, preparing: false }).blocker, "needCondition");
    assert.equal(sendControls({ ...all, preparing: false, needsCondition: false }).blocker, "needLocation");
  });
});

describe("the timings", () => {
  test("are report-flow.md's", () => {
    assert.equal(TOKEN_PATIENCE_MS, 8_000);
    assert.equal(SEND_PATIENCE_MS, 12_000);
  });
});

describe("the form uses it", () => {
  const FORM = readFileSync(
    join(import.meta.dirname, "..", "components", "report", "ReportForm.tsx"),
    "utf8",
  );

  test("the button's state comes from sendControls, not from a condition of its own", () => {
    assert.match(FORM, /const controls = sendControls\(\{/);
    assert.match(FORM, /disabled=\{controls\.disabled\}/);
    // The old condition, which is the whole defect.
    assert.doesNotMatch(FORM, /turnstileEnabled && !turnstileToken\)/);
  });

  test("offline, the button saves; the backups save; both without a token", () => {
    assert.match(FORM, /onClick=\{saving \? saveOnPhone : submit\}/);
    assert.match(FORM, /\{controls\.backup && \(/);
    const save = FORM.slice(FORM.indexOf("async function saveOnPhone"), FORM.indexOf("async function submit"));
    assert.ok(save.length > 0);
    assert.doesNotMatch(save, /turnstileToken/, "saving must not need, or store, a token");
    assert.match(save, /await enqueue\(/);
  });

  test("saving mid-send abandons the send under the same nonce", () => {
    const save = FORM.slice(FORM.indexOf("async function saveOnPhone"), FORM.indexOf("async function submit"));
    assert.match(save, /liveSend\.current \+= 1;/);
    assert.match(save, /inFlight\.current\?\.abort\(\);/);
    assert.match(save, /id: nonce\.current,/);
    // And a send that was abandoned does not land on top of the saved card.
    assert.match(FORM, /if \(!stillMine\(\)\) return;/);
  });

  test("the widget is not drawn while offline, and comes back with the signal", () => {
    assert.match(FORM, /\{online && \(\s*<Turnstile/);
    const widget = readFileSync(
      join(import.meta.dirname, "..", "components", "report", "Turnstile.tsx"),
      "utf8",
    );
    assert.match(widget, /el\.onerror = \(\) => el\.remove\(\);/);
  });
});
