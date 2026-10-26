/**
 * The printable poster (/poster): its QR codes send people to production's
 * report page, in the poster's language, and it says only what the site says.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL, requireServer } from "./helpers.mjs";
import { CANONICAL_ORIGIN } from "../lib/siteUrl.ts";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

describe("the poster", () => {
  test("has one QR code per language, as static SVG", () => {
    for (const lang of ["zh", "en"]) {
      const svg = read(`public/poster/report-${lang}.svg`);
      // Version 4 (33 modules) and a four-module quiet zone each side: what
      // scripts/make-qr.swift writes for these addresses. Anything else means
      // the file was not made by it, or encodes something longer.
      assert.match(svg, /^<svg [^>]*viewBox="0 0 41 41"/, lang);
      assert.match(svg, /<rect width="41" height="41" fill="#fff"\/>/, lang);
    }
  });

  test("prints production's address, whatever server it is printed from", () => {
    const src = read("app/[locale]/(site)/poster/page.tsx");
    assert.match(src, /const reportUrl = `\$\{CANONICAL_ORIGIN\}\$\{zh \? "" : "\/en"\}\/report`/);
    assert.match(src, /src=\{`\/poster\/report-\$\{zh \? "zh" : "en"\}\.svg`\}/);
  });

  test("renders in both languages with its code and its address", async (t) => {
    if (!(await requireServer(t))) return;
    for (const [path, lang, url] of [
      ["/poster", "zh", `${CANONICAL_ORIGIN}/report`],
      ["/en/poster", "en", `${CANONICAL_ORIGIN}/en/report`],
    ]) {
      const res = await fetch(`${BASE_URL}${path}`);
      assert.equal(res.status, 200, path);
      const html = await res.text();
      assert.ok(html.includes(`/poster/report-${lang}.svg`), `${path} shows its code`);
      assert.ok(html.includes(url.replace(/^https:\/\//, "")), `${path} prints ${url}`);
      // The promise it repeats is the site's own sentence.
      const home = JSON.parse(read(`messages/${lang === "zh" ? "zh-TW" : "en"}.json`)).home;
      assert.ok(html.includes(home.askHint), `${path} repeats home.askHint`);
    }
    const svg = await fetch(`${BASE_URL}/poster/report-zh.svg`);
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get("content-type") ?? "", /image\/svg\+xml/);
  });
});
