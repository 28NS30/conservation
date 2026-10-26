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
 *
 * And from a look at what a search engine was given, in October 2026:
 *
 *   - The sitemap was one file under `limit 5000`, choosing species by a rule
 *     of its own. It listed 1,781 species while the species page called
 *     29,468 indexworthy. Both now read INDEXWORTHY (lib/indexworthy.ts),
 *     and the sitemap is an index of one set of files per language.
 *   - THE INDEXING POLICY, held below: a record imported from GBIF is
 *     `noindex, follow` (one row of TaiRON's already-published dataset,
 *     46,305 near-identical thin pages); a public report filed here is
 *     indexed and in the sitemap; a page of a paged list is its own
 *     canonical, and a filtered view names the unfiltered list. The reasons
 *     are written where each is decided: the record page's generateMetadata,
 *     lib/sitemaps.ts and pagedPath in lib/alternates.ts.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql, BASE_URL, requireServer, sitemapFiles, insertReport } from "./helpers.mjs";
import { INDEXWORTHY } from "../lib/indexworthy.ts";

after(() => sql.end());

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
    if (!(await requireServer(t))) return;
    const txt = await (await fetch(`${BASE_URL}/robots.txt`)).text();
    for (const path of ["/admin", "/en/admin", "/login", "/en/login", "/me", "/en/me", "/api/"])
      assert.match(txt, new RegExp(`^Disallow: ${path.replace(/\//g, "\\/")}$`, "m"), path);
  });
});

const PREFIX = { "zh-TW": "", en: "/en" };
const NOINDEX = /<meta name="robots" content="noindex/;

/** The sitemap's files, read once for the tests below. */
let filesOnce;
const files = () => (filesOnce ??= sitemapFiles());
const localeOf = (f) => /^\/sitemap\/(zh-TW|en)-/.exec(f.path)?.[1];
const speciesIds = (urls) =>
  urls.map((u) => /\/species\/(\d+)/.exec(new URL(u).pathname)?.[1]).filter(Boolean).map(Number);

/** Path and query of a page's canonical link. */
async function canonicalOf(path) {
  const html = await (await fetch(`${BASE_URL}${path}`, { redirect: "follow" })).text();
  const href = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  assert.ok(href, `${path} has no canonical`);
  const u = new URL(href);
  return u.pathname + u.search;
}

describe("robots.txt names the sitemap index", () => {
  test("and the index answers there", async (t) => {
    if (!(await requireServer(t))) return;
    const txt = await (await fetch(`${BASE_URL}/robots.txt`)).text();
    const named = /^Sitemap: (\S+)$/m.exec(txt)?.[1];
    assert.ok(named, "robots.txt names no sitemap");
    assert.equal(new URL(named).pathname, "/sitemap.xml");
    const index = await fetch(`${BASE_URL}/sitemap.xml`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type") ?? "", /xml/);
    assert.match(await index.text(), /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  });
});

describe("the sitemap", () => {
  test("is an index of files, one set per language, each under the protocol's limit", async (t) => {
    if (!(await requireServer(t))) return;
    const all = await files();
    assert.ok(all.length >= 4, `the index lists ${all.length} files`);
    for (const f of all) {
      assert.match(f.path, /^\/sitemap\/(zh-TW|en)-(pages|records-\d+|species-\d+)\.xml$/, f.path);
      assert.equal(f.status, 200, f.path);
      assert.match(f.type ?? "", /xml/, f.path);
      assert.match(f.xml, /<urlset/, f.path);
      assert.ok(f.urls.length <= 50_000, `${f.path} has ${f.urls.length} URLs`);
      // Each file is one language's pages, and nothing else.
      for (const u of f.urls) {
        const english = new URL(u).pathname === "/en" || new URL(u).pathname.startsWith("/en/");
        assert.equal(english, localeOf(f) === "en", `${u} in ${f.path}`);
      }
    }
    for (const locale of Object.keys(PREFIX)) {
      assert.ok(all.some((f) => f.path === `/sitemap/${locale}-pages.xml`), `${locale} pages`);
      assert.ok(all.some((f) => f.path.startsWith(`/sitemap/${locale}-species-`)), `${locale} species`);
    }
  });

  test("lists each home page at the address that answers", async (t) => {
    if (!(await requireServer(t))) return;
    const locs = (await files()).flatMap((f) => f.urls);
    assert.ok(locs.length > 10);
    assert.ok(!locs.some((u) => /\/en\/$/.test(u)), "/en/ redirects; list /en");
    assert.ok(locs.some((u) => /\/en$/.test(u)), "the English home page is listed");
  });

  test("lists species and subspecies pages only", async (t) => {
    if (!(await requireServer(t))) return;
    const ids = speciesIds((await files()).flatMap((f) => f.urls));
    assert.ok(ids.length > 0, "no species in the sitemap");
    const [{ n }] = await sql`
      select count(*)::int as n from taxa
       where id = any(${ids}) and rank not in ('Species', 'Subspecies')`;
    assert.equal(n, 0);
  });

  test("lists, in each language, exactly the species INDEXWORTHY admits", async (t) => {
    if (!(await requireServer(t))) return;
    // The files were written when the server built them; the database is
    // read now. Other test files commit a report for a moment and delete it,
    // which can make a species indexworthy while it exists, so the count is
    // read again for a few seconds before a difference counts as one.
    const listed = speciesIds(
      (await files()).filter((f) => f.path.startsWith("/sitemap/zh-TW-species-")).flatMap((f) => f.urls),
    ).sort((a, b) => a - b);
    let want = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      want = (
        await sql`
          select t.id from taxa t
            left join species_report_stats s on s.taxon_id = t.id
           where ${sql.unsafe(INDEXWORTHY)}
           order by t.id`
      ).map((r) => r.id);
      if (want.length === listed.length && want.every((id, i) => id === listed[i])) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    assert.ok(want.length > 0, "the fixture has no indexworthy species");
    for (const locale of Object.keys(PREFIX)) {
      const ids = speciesIds(
        (await files()).filter((f) => f.path.startsWith(`/sitemap/${locale}-species-`)).flatMap((f) => f.urls),
      );
      assert.equal(ids.length, new Set(ids).size, `${locale}: a species is listed twice`);
      assert.equal(ids.length, want.length, `${locale}: ${ids.length} species listed, ${want.length} indexworthy`);
      assert.deepEqual([...ids].sort((a, b) => a - b), want, `${locale}: not the same species`);
    }
  });

  test("never offers a page that answers noindex", async (t) => {
    if (!(await requireServer(t))) return;
    // Every fixed page and every record, and a spread of species from each
    // language's files: first, last and evenly between.
    const picked = [];
    for (const f of await files()) {
      if (!/-species-/.test(f.path)) picked.push(...f.urls);
      else {
        const n = f.urls.length;
        const at = new Set([0, 1, n - 2, n - 1, ...[1, 2, 3, 4].map((k) => Math.floor((k * n) / 5))]);
        for (const i of at) if (i >= 0 && i < n) picked.push(f.urls[i]);
      }
    }
    for (const u of picked) {
      const { pathname } = new URL(u);
      const res = await fetch(`${BASE_URL}${pathname}`, { redirect: "manual" });
      assert.equal(res.status, 200, `${pathname} answered ${res.status}`);
      assert.doesNotMatch(await res.text(), NOINDEX, `${pathname} is in the sitemap and says noindex`);
    }
  });

  test("lists a record only if it is a public report filed here", async (t) => {
    if (!(await requireServer(t))) return;
    const ids = (await files())
      .flatMap((f) => f.urls)
      .map((u) => /\/reports\/([0-9a-f-]{36})$/.exec(new URL(u).pathname)?.[1])
      .filter(Boolean);
    if (ids.length === 0) return; // none filed here yet; the test below files one
    const [{ n }] = await sql`
      select count(*)::int as n from reports_public where id = any(${ids}::uuid[]) and source = 'user'`;
    assert.equal(n, new Set(ids).size, "a record in the sitemap is imported, or not public");
  });
});

describe("which record pages are indexed", () => {
  test("a record imported from GBIF is noindex, follow", async (t) => {
    if (!(await requireServer(t))) return;
    const [r] = await sql`select id from reports_public where source = 'gbif' order by id limit 1`;
    assert.ok(r, "the fixture has no imported record");
    for (const prefix of Object.values(PREFIX)) {
      const html = await (await fetch(`${BASE_URL}${prefix}/reports/${r.id}`)).text();
      assert.match(html, /<meta name="robots" content="noindex, follow"/, `${prefix}/reports/${r.id}`);
    }
  });

  test("a public report filed here is indexed", async (t) => {
    if (!(await requireServer(t))) return;
    // A common, unprotected species, so the record is public at its point.
    const [taxon] = await sql`
      select id from taxa
       where scientific_name = 'Duttaphrynus melanostictus' and rank = 'Species' limit 1`;
    assert.ok(taxon, "the fixture lacks 黑眶蟾蜍");
    const r = await insertReport(sql, { taxonId: taxon.id });
    try {
      for (const prefix of Object.values(PREFIX)) {
        const res = await fetch(`${BASE_URL}${prefix}/reports/${r.id}`);
        assert.equal(res.status, 200);
        assert.doesNotMatch(await res.text(), NOINDEX, `${prefix}/reports/${r.id}`);
      }
    } finally {
      await sql`delete from reports where id = ${r.id}`;
    }
  });
});

describe("a species page outside INDEXWORTHY", () => {
  test("is not indexed", async (t) => {
    if (!(await requireServer(t))) return;
    // A species with a name and nothing else of its own: no record, no
    // status, no Chinese alternate names. Made here, because the fixture's
    // taxa are each chosen for something distinguishing.
    const [row] = await sql`
      insert into taxa (taicol_id, scientific_name, rank, is_in_taiwan, taxon_status)
      values (${`test-thin-${process.pid}-${Date.now()}`}, ${`Testudothin e${process.pid}x${Date.now()}`},
              'Species', true, 'accepted')
      returning id`;
    try {
      const [{ ok }] = await sql`
        select ${sql.unsafe(INDEXWORTHY)} as ok
          from taxa t left join species_report_stats s on s.taxon_id = t.id
         where t.id = ${row.id}`;
      assert.equal(ok, false);
      const res = await fetch(`${BASE_URL}/en/species/${row.id}`, { redirect: "follow" });
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<meta name="robots" content="noindex, follow"/);
    } finally {
      await sql`delete from taxa where id = ${row.id}`;
    }
  });
});

describe("a paged list", () => {
  test("names each page as its own canonical", async (t) => {
    if (!(await requireServer(t))) return;
    assert.equal(await canonicalOf("/reports?page=2"), "/reports?page=2");
    assert.equal(await canonicalOf("/en/reports?page=3"), "/en/reports?page=3");
    assert.equal(await canonicalOf("/species?page=2"), "/species?page=2");
    assert.equal(await canonicalOf("/reports?page=1"), "/reports");
  });

  test("filtered, names the unfiltered list", async (t) => {
    if (!(await requireServer(t))) return;
    assert.equal(await canonicalOf("/species?filter=protected&page=2"), "/species");
    assert.equal(await canonicalOf("/en/reports?collection=roadkill&page=2"), "/en/reports");
  });
});

describe("a page for a family or a genus", () => {
  test("is not indexed and does not offer to report it", async (t) => {
    if (!(await requireServer(t))) return;
    const row = await aboveSpecies();
    if (!row) return t.skip("no protected or invasive group above species here");
    const res = await fetch(`${BASE_URL}/en/species/${row.id}`, { redirect: "follow" });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<meta name="robots" content="noindex/);
    assert.doesNotMatch(html, new RegExp(`/report\\?taxonId=${row.id}\\b`));
  });

  test("named in a report, is filed as unidentified rather than refused", async (t) => {
    if (!(await requireServer(t))) return;
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
    if (!(await requireServer(t))) return;
    const html = await (await fetch(`${BASE_URL}/en/admin`)).text();
    assert.match(html, /<title>Moderation queue · /);
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  });
});
