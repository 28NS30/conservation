/**
 * What a crawler is pointed at, and what a page above species level offers.
 * From a sweep of the live site:
 *
 *   - robots.txt kept crawlers off /admin and /login but not /en/admin and
 *     /en/login, and /admin shared the home page's title.
 *   - The sitemap listed "/en/", which answers with a redirect, and 99 family
 *     and genus pages (Felidae, Primates, Rhinocerotidae) that are protected or
 *     invasive as a group and are otherwise empty.
 *   - Those pages offered "be the first to report it", opening the form on a
 *     name the picker never offers.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql, BASE_URL } from "./helpers.mjs";

after(() => sql.end());

async function server() {
  return (await fetch(BASE_URL).catch(() => null)) !== null;
}

async function aboveSpecies() {
  const [t] = await sql`
    select id from taxa
     where rank not in ('Species', 'Subspecies')
       and taxon_status = 'accepted' and is_in_taiwan
       and (protected_status is not null or is_invasive)
     order by id limit 1`;
  return t ?? null;
}

describe("robots.txt", () => {
  test("keeps crawlers off the private pages in both locales", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const txt = await (await fetch(`${BASE_URL}/robots.txt`)).text();
    for (const path of ["/admin", "/en/admin", "/login", "/en/login", "/me", "/en/me", "/api/"])
      assert.match(txt, new RegExp(`^Disallow: ${path.replace(/\//g, "\\/")}$`, "m"), path);
  });
});

describe("the sitemap", () => {
  test("lists each home page at the address that answers", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const xml = await (await fetch(`${BASE_URL}/sitemap.xml`)).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length > 10);
    assert.ok(!locs.some((u) => /\/en\/$/.test(u)), "/en/ redirects; list /en");
    assert.ok(locs.some((u) => /\/en$/.test(u)), "the English home page is listed");
  });

  test("lists species and subspecies pages only", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const xml = await (await fetch(`${BASE_URL}/sitemap.xml`)).text();
    const ids = [...xml.matchAll(/\/species\/(\d+)/g)].map((m) => Number(m[1]));
    if (!ids.length) return t.skip("no species in this sitemap");
    const [{ n }] = await sql`
      select count(*)::int as n from taxa
       where id = any(${ids}) and rank not in ('Species', 'Subspecies')`;
    assert.equal(n, 0);
  });
});

describe("a page for a family or a genus", () => {
  test("is not indexed and does not offer to report it", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const row = await aboveSpecies();
    if (!row) return t.skip("no protected or invasive group above species here");
    const res = await fetch(`${BASE_URL}/en/species/${row.id}`, { redirect: "follow" });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<meta name="robots" content="noindex/);
    assert.doesNotMatch(html, new RegExp(`/report\\?taxonId=${row.id}\\b`));
  });

  test("named in a report, is filed as unidentified rather than refused", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const row = await aboveSpecies();
    if (!row) return t.skip("no protected or invasive group above species here");
    await sql`delete from rate_limits where key like 'submit-%'`;
    const clientNonce = randomUUID();
    try {
      const res = await fetch(`${BASE_URL}/api/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "sighting", lng: 120.9, lat: 23.8,
          observedAt: new Date().toISOString(), photoPaths: [],
          clientNonce, taxonId: row.id,
        }),
      });
      assert.equal(res.status, 201, await res.text());
      const [r] = await sql`select taxon_id from reports where client_nonce = ${clientNonce}`;
      assert.equal(r.taxon_id, null, "a family was stored as the animal");
    } finally {
      await sql`delete from reports where client_nonce = ${clientNonce}`;
    }
  });
});

describe("the moderation queue", () => {
  test("has its own title and is never indexed", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const html = await (await fetch(`${BASE_URL}/en/admin`)).text();
    assert.match(html, /<title>Moderation queue · /);
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  });
});
