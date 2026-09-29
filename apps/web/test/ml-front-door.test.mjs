/**
 * The classifier service's front door, held to what the security audit of 29
 * September 2026 found: any request, a tokenless one included, cold-started a
 * GPU; the service would fetch any URL for a token holder; and a photograph it
 * refused was sent to it five times. The service's own behaviour is tested in
 * apps/ml/test_contract.py; this holds the deployment and the website to it.
 *
 *   node --test test/ml-front-door.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");

describe("the classifier service", () => {
  const modal = read("apps", "ml", "modal_app.py");
  const endpoint = read("apps", "ml", "endpoint.py");

  test("the web endpoint is a CPU function, and the GPU class serves none", () => {
    const front = modal.slice(modal.indexOf("@app.function("));
    assert.ok(front.length > 0, "no front function");
    assert.doesNotMatch(front.slice(0, front.indexOf("def classify")), /gpu=/, "the front function asks for a GPU");
    const cls = modal.slice(modal.indexOf("@app.cls("), modal.indexOf("@app.function("));
    assert.doesNotMatch(cls, /fastapi_endpoint/, "the GPU class still answers the web");
    assert.match(cls, /@modal\.method\(\)/);
  });

  test("the front door keeps the URL the website is configured with", () => {
    assert.match(modal, /label="conservation-classifier-service-classify"/);
  });

  test("the token is checked before the GPU is called", () => {
    const body = modal.slice(modal.indexOf("def classify"));
    const parse = body.indexOf("parse(payload");
    const remote = body.indexOf("Service().run.remote(");
    assert.ok(parse > 0 && remote > parse, "the GPU is reached before the token is checked");
    assert.match(body, /if isinstance\(parsed, tuple\):/);
  });

  test("the service fetches no URL", () => {
    assert.doesNotMatch(endpoint, /fetch_image|requests\.get/);
    assert.doesNotMatch(modal, /requests\.get/);
  });

  test("an image too large to decode is refused from its header", () => {
    const pipeline = read("apps", "ml", "pipeline.py");
    assert.match(pipeline, /if w \* h > MAX_IMAGE_PIXELS:/);
    assert.match(pipeline, /img = open_image\(image_bytes\)/);
  });
});

describe("the website", () => {
  test("gives up at once on a photograph the model refuses", () => {
    const worker = read("apps", "web", "lib", "report", "classifyWorker.ts");
    assert.match(worker, /res\.status === 400 \? new ModelRefused\(message\) : new Error\(message\)/);
    assert.match(worker, /const giveUp = job\.attempts >= MAX_ATTEMPTS \|\| err instanceof ModelRefused;/);
    assert.equal((worker.match(/if \(!res\.ok\) throw await modelError\(res\);/g) ?? []).length, 2,
      "both model calls must read the answer the same way");
  });
});
