/**
 * The accessibility floor.
 *
 * Not an audit — an audit needs a person and a screen reader. These are the
 * handful of structural facts that everything else rests on, each of which was
 * absent at some point and none of which shows up as a broken page: a form that
 * is not a form, an input with no label, a chart whose numbers exist only in a
 * tooltip. Every one of them returns 200 and looks finished.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.mjs";

const get = (path) => fetch(`${BASE_URL}${path}`).then((r) => r.text());

describe("sign in", () => {
  let html;
  test("the page is reachable", async () => {
    html = await get("/login");
    assert.ok(html.length > 0);
  });

  test("it is a real form, so Enter submits it", async () => {
    // It was an input and a button with an onClick. Typing an address and
    // pressing Enter did nothing at all, which on a one-field page reads as the
    // site being broken rather than as a missing element.
    assert.match(html, /<form[^>]*>/, "expected a <form>");
    assert.match(html, /type="submit"/, "expected a submit button");
  });

  test("the input has a visible label bound to it", async () => {
    const forAttr = /<label[^>]*\bfor="([^"]+)"/.exec(html)?.[1];
    assert.ok(forAttr, "expected a <label for=...>");
    assert.match(
      html,
      new RegExp(`<input[^>]*\\bid="${forAttr}"`),
      "the label's for= must name the input's id",
    );
    // A placeholder is not a label: it disappears as soon as anyone types.
    assert.match(html, /autocomplete="email"/i);
  });
});
