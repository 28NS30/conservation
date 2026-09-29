/**
 * Each page says which address is the page, what it is in the other language,
 * and what it is about.
 *
 * From a sweep of the live site: no page had a canonical link, so filtered
 * views such as /species?filter=protected were indexed as pages of their own
 * under the directory's title; nothing tied /about to /en/about; and most
 * pages repeated the site-wide description. lib/alternates.ts.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BASE_URL } from "./helpers.mjs";

async function server() {
  return (await fetch(BASE_URL).catch(() => null)) !== null;
}

const head = async (path) => {
  const html = await (await fetch(`${BASE_URL}${path}`, { redirect: "follow" })).text();
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
  const langs = Object.fromEntries(
    [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/gi)].map((m) => [m[1], m[2]]),
  );
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? null;
  return { canonical, langs, description };
};

const PAGES = ["", "/about", "/attribution", "/privacy", "/species", "/reports", "/stats", "/map", "/report", "/report/roadkill", "/roadkill", "/invasive", "/wildlife"];

describe("canonical and language links", () => {
  for (const path of PAGES)
    test(path || "/", async (t) => {
      if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
      const zh = await head(path || "/");
      const en = await head(`/en${path}`);
      assert.ok(zh.canonical?.endsWith(path || "/"), `zh canonical is ${zh.canonical}`);
      assert.ok(en.canonical?.endsWith(`/en${path}`), `en canonical is ${en.canonical}`);
      assert.ok(!zh.canonical.includes("/en"), "the Chinese page is not canonicalised to English");
      for (const h of [zh, en]) {
        assert.ok(h.langs["zh-TW"] && h.langs.en && h.langs["x-default"], `language links on ${path}`);
        assert.equal(h.langs["x-default"], h.langs["zh-TW"]);
      }
    });

  test("a filtered view names the unfiltered page as canonical", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const { canonical } = await head("/species?filter=protected");
    assert.ok(canonical?.endsWith("/species"), `canonical is ${canonical}`);
  });
});

describe("descriptions", () => {
  test("pages that had the site's own description now describe themselves", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const site = (await head("/")).description;
    for (const path of ["/about", "/privacy", "/attribution", "/species", "/reports", "/map", "/report", "/en/map", "/en/report"]) {
      const { description } = await head(path);
      assert.ok(description, `${path} has a description`);
      assert.notEqual(description, site, `${path} repeats the site-wide description`);
    }
  });
});
