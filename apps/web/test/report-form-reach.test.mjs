/**
 * The report form, for someone without a pointer, without a position, or
 * without much screen.
 *
 * A keyboard user whose browser could give no position could not file a
 * report at all: the pin went down only by a click or a drag (WCAG 2.1.1).
 * Someone who had tapped "Don't allow" was told to try again for ever. After
 * sending, a phone was left looking at the footer, with focus on a button that
 * had gone. On an iPhone SE some 40% of the screen was header and send bar.
 * The browser specs prove these in a real page (e2e/report-keyboard.spec.mjs,
 * e2e/receipt.spec.mjs, e2e/reflow.spec.mjs); these are the parts that a
 * later edit could quietly undo without a browser noticing until CI.
 *
 *   node --test test/report-form-reach.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL, requireServer } from "./helpers.mjs";

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const catalogue = (l) => JSON.parse(read("messages", `${l}.json`));
const LOCALES = ["zh-TW", "en"];

const PICKER = read("components", "report", "LocationPicker.tsx");
const FORM = read("components", "report", "ReportForm.tsx");
const SPECIES = read("components", "report", "SpeciesPicker.tsx");
const SUGGEST = read("components", "report", "PhotoSuggestions.tsx");
const CSS = read("app", "globals.css");

describe("the pin goes down without a pointer", () => {
  test("a button puts it at the map's centre, under a crosshair", () => {
    assert.match(PICKER, /onClick=\{\(\) => placeAtCentre\.current\?\.\(\)\}/);
    assert.match(PICKER, /t\("pinAtCentre"\)/);
    assert.match(PICKER, /const c = h\.map\.getCenter\(\);/);
    for (const l of LOCALES) assert.equal(typeof catalogue(l).report.pinAtCentre, "string", l);
    assert.equal(catalogue("zh-TW").report.pinAtCentre, "把標記放在地圖中心");
    assert.equal(catalogue("en").report.pinAtCentre, "Put the pin at the map's centre");
  });

  test("Enter on the focused map does the same", () => {
    assert.match(PICKER, /canvas\.addEventListener\("keydown"/);
    assert.match(PICKER, /e\.key !== "Enter"/);
  });

  test("the crosshair is drawn, never hit, and says nothing", () => {
    // A tap on it must reach the map, and a finger on the pin beneath it
    // must still drag the pin.
    const svg = /<svg[^>]*?data-crosshair[^>]*>/.exec(PICKER)?.[0] ?? "";
    assert.ok(svg, "the crosshair is an svg marked data-crosshair");
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /pointer-events-none/);
  });

  test("tapping and dragging are as they were", () => {
    assert.match(PICKER, /h\.map\.on\("click", \(e\) => \{\s*place\.current\?\.\(e\.lngLat\.lng, e\.lngLat\.lat\);\s*onChangeRef\.current\(\{ lat: e\.lngLat\.lat, lng: e\.lngLat\.lng \}\);/);
    assert.match(PICKER, /new h\.ml\.Marker\(\{ color: "#e11d48", draggable: true \}\)/);
    assert.match(PICKER, /m\.on\("dragend"/);
  });

  test("the keys are explained to whoever has focus on the map", () => {
    assert.match(PICKER, /canvas\.setAttribute\("aria-describedby", hintId\)/);
    assert.match(PICKER, /peer-has-\[canvas:focus-visible\]:block/);
    for (const l of LOCALES) assert.match(catalogue(l).report.pickerKeys, /Enter/, l);
  });

  test("the canvas's focus ring is drawn inside the clipped container", () => {
    assert.match(PICKER, /data-location-picker/);
    assert.match(CSS, /\[data-location-picker\] \.maplibregl-canvas:focus-visible \{\s*outline-offset: -3px;/);
  });

  test("a pin put down is said, not only drawn", () => {
    assert.match(PICKER, /<p role="status" className="text-sm tabular-nums text-ink-600">\s*\{value && \(/);
  });
});

describe("a refused location says how to allow it", () => {
  test("useGeolocate says why it has no position", () => {
    assert.match(PICKER, /1: "denied",\s*2: "unavailable",\s*3: "timeout",/);
    assert.match(PICKER, /setError\(LOCATE_ERRORS\[err\.code\] \?\? "unavailable"\)/);
    assert.match(PICKER, /return \{ locate, busy, error \};/);
    // The lab's flow reads the same hook, and only `locate` and `busy`.
    assert.match(read("components", "lab", "report", "useReportFlow.ts"), /const \{ locate, busy: locating \} = useGeolocate\(\);/);
  });

  test("denied has its own message, naming iPhone, Android and LINE", () => {
    assert.match(FORM, /locationError && locateError === "denied" && \(\s*<div role="alert"/);
    assert.match(FORM, /locationError && locateError !== "denied" && \(/);
    for (const key of ["title", "body", "ios", "android", "line"])
      assert.match(FORM, new RegExp(`t\\("locationDenied\\.${key}"\\)`), key);
    for (const l of LOCALES) {
      const d = catalogue(l).report.locationDenied;
      assert.match(d.ios, /iPhone/, l);
      assert.match(d.android, /Android/, l);
      assert.match(d.line, /LINE/, l);
      // It says the report does not need the location: the map still works.
      assert.match(d.body, l === "en" ? /tap the map/ : /點地圖/, l);
      assert.notEqual(d.body, catalogue(l).report.locationError, `${l}: not the "couldn't get it" sentence`);
    }
  });

  test("a rough fix is drawn as its circle and said", () => {
    assert.match(PICKER, /export const ROUGH_FIX_M = 100;/);
    assert.match(PICKER, /circlePolygon\(v\.lng, v\.lat, r \/ 1000\)/);
    assert.match(FORM, /accuracyM=\{accuracyM\}/);
    assert.match(FORM, /location && isRoughFix\(accuracyM\) && \(\s*<p role="status"/);
    for (const l of LOCALES) assert.match(catalogue(l).report.roughFix, /\{m\}/, l);
  });
});

describe("focus stays where the reporter is", () => {
  test("after sending, the card's heading is scrolled to and focused", () => {
    const headings = [...FORM.matchAll(/<h2 ref=\{cardHeading\} tabIndex=\{-1\}/g)];
    assert.equal(headings.length, 2, "the receipt and the saved card");
    assert.match(FORM, /\(heading\.parentElement \?\? heading\)\.scrollIntoView\(\{ block: "start" \}\);\s*heading\.focus\(\{ preventScroll: true \}\);/);
  });

  test("a failed send takes focus to its problem, and says it at the button", () => {
    assert.match(FORM, /revealNext\.current = true;\s*fail\(code, e\);/);
    assert.match(FORM, /role="alert" tabIndex=\{-1\}/);
    assert.match(FORM, /id="submit-error"/);
    assert.match(FORM, /onClick=\{\(\) => revealError\(error\.slot\)\}/);
    for (const l of LOCALES) assert.equal(typeof catalogue(l).report.errorShow, "string", l);
  });

  test("a species pick lands on 更改, and 更改 lands in the search box", () => {
    assert.match(SPECIES, /wantFocus\.current = "change";\s*onChange\(h\);/);
    assert.match(SPECIES, /wantFocus\.current = "search";\s*onChange\(null\);/);
    assert.match(SPECIES, /if \(want === "change"\) changeRef\.current\?\.focus\(\);\s*else if \(want === "search"\) searchRef\.current\?\.focus\(\);/);
    // A photo suggestion is a pick too.
    assert.match(FORM, /speciesPicker\.current\?\.pickedElsewhere\(\);/);
  });

  test("the photo suggestions keep one live region", () => {
    assert.equal([...SUGGEST.matchAll(/role="status"/g)].length, 1);
    assert.doesNotMatch(SUGGEST, /return null;/, "the region must stay in the page");
    assert.match(FORM, /<PhotoSuggestions\s+state=\{photoIdea\}\s+hidden=\{species !== null \|\| unsure\}/);
  });
});

describe("short screens", () => {
  test("the header says what it is, for the stylesheet", () => {
    const header = read("components", "site", "SiteHeader.tsx");
    assert.match(header, /data-site-header=\{app \? "app" : "page"\}/);
    assert.match(header, /data-site-phone-nav/);
  });

  test("under 560px of height the report pages pin no header and drop its link row", () => {
    const block = /@media \(max-height: 560px\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    assert.match(block, /html:has\(#report-form\) \[data-site-header="page"\] \{\s*position: static;/);
    assert.match(block, /html:has\(#report-form\) \[data-site-phone-nav\] \{\s*display: none;/);
    assert.match(FORM, /<div id="report-form">/);
  });

  test("under 500px the send bar stops following", () => {
    const block = /@media \(max-height: 500px\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    assert.match(block, /#report-send-bar \{\s*position: static;/);
  });

  test("what is scrolled to stops below a pinned header", () => {
    assert.match(CSS, /html:has\(\[data-site-header="page"\]\) \{\s*scroll-padding-top: calc\(var\(--header-height\) \+ 0\.75rem\);/);
    assert.match(FORM, /root\.style\.setProperty\("--header-height"/);
  });
});

describe("a way past the header", () => {
  test("the site layout starts with a skip link to the page's content", () => {
    const layout = read("app", "[locale]", "(site)", "layout.tsx");
    assert.match(layout, /<SkipLink \/>\s*<SiteHeader/);
    assert.match(layout, /<div id=\{MAIN_CONTENT_ID\} className="flex-1">/);
    for (const l of LOCALES) assert.equal(typeof catalogue(l).nav.skipToContent, "string", l);
  });

  test("it is the first thing in the page, and its target exists", async (t) => {
    if (!(await requireServer(t))) return;
    for (const path of ["/report/wildlife", "/en/report/wildlife", "/species"]) {
      const html = await (await fetch(`${BASE_URL}${path}`)).text();
      const body = html.slice(html.indexOf("<body"));
      const firstLink = /<a\s[^>]*href="([^"]*)"/.exec(body)?.[1];
      assert.equal(firstLink, "#main-content", `${path}: the first link is the skip link`);
      assert.match(html, /<div id="main-content"/, path);
    }
  });
});

describe("MapLibre speaks the page's language", () => {
  test("createMap hands MapLibre the strings it is given", () => {
    assert.match(read("lib", "map.ts"), /\.\.\.\(opts\.strings \? \{ locale: opts\.strings \} : \{\}\)/);
  });

  test("every map on the site passes them", () => {
    for (const f of [
      ["components", "report", "LocationPicker.tsx"],
      ["components", "report", "ReportMap.tsx"],
      ["components", "map", "HeatmapView.tsx"],
      ["components", "species", "SpeciesMap.tsx"],
    ]) {
      const src = read(...f);
      assert.match(src, /useMapStrings\(\)/, f.join("/"));
      assert.match(src, /strings(: stringsRef\.current)?,\n/, f.join("/"));
    }
  });

  test("each string MapLibre is given exists in both catalogues", () => {
    const hook = read("lib", "mapStrings.ts");
    const keys = [...hook.matchAll(/"[A-Za-z]+\.[A-Za-z]+": t\("([a-zA-Z]+)"\)/g)].map((m) => m[1]);
    assert.ok(keys.length >= 10, `only ${keys.length} strings`);
    for (const l of LOCALES)
      for (const k of keys) assert.equal(typeof catalogue(l).map.maplibre[k], "string", `${l}: map.maplibre.${k}`);
    assert.equal(catalogue("zh-TW").map.maplibre.zoomIn, "放大");
  });
});
