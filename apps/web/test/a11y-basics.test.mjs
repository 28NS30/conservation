/**
 * The accessibility floor.
 *
 * Not an audit — an audit needs a person and a screen reader. These are the
 * handful of structural facts that everything else rests on, each of which was
 * absent at some point and none of which shows up as a broken page: a form that
 * is not a form, an input with no label, a chart whose numbers exist only in a
 * tooltip. Every one of them returns 200 and looks finished.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL, sql } from "./helpers.mjs";

after(() => sql.end());

const get = (path) => fetch(`${BASE_URL}${path}`).then((r) => r.text());

const figures = (html) => html.match(/<figure>[\s\S]*?<\/figure>/g) ?? [];

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

describe("charts give their numbers without a hover", () => {
  /*
   * The values lived in a `title` attribute and nowhere else. A title is a
   * hover: no phone has one, no keyboard has one, and screen readers announce
   * it inconsistently or not at all. On the page whose entire purpose is
   * publishing numbers, the numbers were for mouse users only.
   */
  test("every figure on the statistics page carries a table", async () => {
    for (const path of ["/stats", "/en/stats"]) {
      const figs = figures(await get(path));
      assert.ok(figs.length > 0, `expected figures on ${path}`);
      for (const f of figs)
        assert.match(f, /<table/, `a figure on ${path} has no table`);
    }
  });

  test("the species seasonality chart carries one too", async () => {
    // The most-reported species, whatever it is on this cluster: the chart only
    // renders where there are records to plot.
    const [{ id }] = await sql`
      select taxon_id as id from species_report_stats
       order by report_count desc limit 1`;
    for (const prefix of ["", "/en"]) {
      const figs = figures(await get(`${prefix}/species/${id}`));
      assert.ok(figs.length > 0, `expected a figure at ${prefix}/species/${id}`);
      for (const f of figs) assert.match(f, /<table/);
    }
  });

  test("the English month axis does not repeat a label", async () => {
    // Intl's narrow month names in English are J F M A M J J A S O N D: seven
    // distinct letters for twelve months, on a chart whose claim is that May
    // and June differ.
    const fig = figures(await get("/en/stats"))[0];
    const axis = [
      ...fig.matchAll(/text-\[9px\] tabular-nums text-ink-500">([^<]*)</g),
    ].map((m) => m[1]);
    assert.equal(axis.length, 12, "expected twelve months on the axis");
    assert.equal(
      new Set(axis).size,
      axis.length,
      `axis labels repeat: ${axis.join(",")}`,
    );
  });
});

describe("the page surfaces are light", () => {
  const WEB = new URL("..", import.meta.url).pathname;
  const css = readFileSync(join(WEB, "app/globals.css"), "utf8");

  test("the root colour scheme is light", () => {
    /*
     * `color-scheme` is not a colour: it tells the browser which palette to
     * paint the parts of a control we do not draw. Declared dark at the root,
     * on a site whose pages are cream, it rendered the report form's checkbox
     * black on black and opened its date picker as a dark panel — invisible in
     * the stylesheet and in every class name.
     */
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    assert.match(root, /color-scheme:\s*light/);
    assert.ok(
      !/color-scheme:\s*dark/.test(root),
      ":root must not declare the dark scheme",
    );
    // The map still needs it, scoped to the element that is actually dark.
    assert.match(css, /\.on-dark\s*\{[^}]*color-scheme:\s*dark/);
  });

  test("a reader who asked for less motion gets it", () => {
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  test("the report form carries the map palette only on the map", () => {
    // `parchment` and `sky` belong to the dark map and to the default Tailwind
    // palette respectively. On cream they measured 2.90:1 and 1.02–1.28:1 —
    // the second is invisible rather than merely low-contrast.
    //
    // This began as "no parchment class anywhere under components/report",
    // which held only while nothing in that directory was dark. The picker's
    // overlay is: a chip that paints `bg-bark-950` over the map canvas, where
    // `text-parchment-50` measures 16.35:1 and is the same pairing every
    // component under components/map uses. Banning it there would have pushed
    // that chip onto an ink colour it cannot be read in.
    //
    // So the rule is the one that was always meant — the map's palette may not
    // be used on the cream page — and it is enforced by asking what background
    // is painted beside the token rather than by the token's name alone. A
    // parchment or sky class is an offender unless the class list holding it
    // also lays the dark map ground underneath it, and one written outside any
    // class list is an offender regardless.
    const dir = join(WEB, "components/report");
    const offenders = [];
    for (const name of readdirSync(dir)) {
      if (!/\.tsx?$/.test(name)) continue;
      const text = readFileSync(join(dir, name), "utf8");
      const lists = [...text.matchAll(/"[^"\n]*"|`[^`]*`/g)];
      for (const m of text.matchAll(/\b[a-z-]*-(sky|parchment)-\d+\b/g)) {
        const holder = lists.find(
          (l) =>
            l.index <= m.index &&
            m.index + m[0].length <= l.index + l[0].length,
        );
        if (holder && /\bbg-bark-\d+\b/.test(holder[0])) continue;
        offenders.push(`${name}: ${m[0]}`);
      }
    }
    assert.deepEqual([...new Set(offenders)], []);
  });
});
