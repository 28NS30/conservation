/**
 * The collections as a visitor meets them: three pages of their own, a filter
 * on the list and the map, the "Invasive" mark on a record, and /stats.
 *
 * Read against the running server, in both languages, with every number
 * checked against the public view rather than written down: the pages count
 * live, and a hard-coded figure here would be right on one database only.
 *
 *   TEST_BASE_URL=http://localhost:3000 node --test test/collection-pages.test.mjs
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectionFor } from "@conservation/shared";
import { sql, BASE_URL } from "./helpers.mjs";

after(() => sql.end());

before(async () => {
  const res = await fetch(BASE_URL).catch(() => null);
  if (!res) throw new Error(`server not reachable at ${BASE_URL}`);
});

const catalogue = (l) =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "messages", `${l}.json`), "utf8"),
  ).collections;
const zh = catalogue("zh-TW");
const en = catalogue("en");

const page = async (path) => {
  const res = await fetch(`${BASE_URL}${path}`);
  const html = await res.text();
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  return { status: res.status, html, title };
};

/** How many public records a collection holds, by the reading every page uses. */
async function count(f) {
  const { categories, invasiveOnly } = selectionFor(f);
  const [row] = await sql`
    select count(*)::int as n from reports_public rp
     where (${categories}::text[] is null or rp.category = any(${categories}))
       and (not ${invasiveOnly}::boolean or rp.is_invasive)`;
  return row.n;
}

/** An attribute value as React writes it into HTML. */
const attr = (s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("the three collection pages", () => {
  for (const c of ["roadkill", "invasive", "wildlife"]) {
    test(`/${c} and /en/${c} render, titled by the collection`, async () => {
      const z = await page(`/${c}`);
      const e = await page(`/en/${c}`);
      assert.equal(z.status, 200);
      assert.equal(e.status, 200);
      assert.ok(z.title.startsWith(`${zh.name[c]} · `), `zh title is "${z.title}"`);
      assert.ok(e.title.startsWith(`${attr(en.name[c])} · `), `en title is "${e.title}"`);
    });

    test(`/${c} states its live count and links to its report page`, async () => {
      const n = await count({ collection: c });
      const { html } = await page(`/en/${c}`);
      assert.ok(html.includes(`href="/en/report/${c}"`), "no link to the report page");
      if (n === 0) {
        // An empty collection offers no map: a blank map reads as broken.
        assert.ok(!html.includes(`href="/en/map?collection=${c}"`), "a map link over nothing");
        assert.ok(html.includes(attr(en[c].empty).slice(0, 40)), "the empty state is missing");
      } else {
        assert.ok(html.includes(`href="/en/map?collection=${c}"`), "no link onto the map");
        assert.ok(
          html.includes(`>${n.toLocaleString("en")}<`),
          `the count ${n.toLocaleString("en")} is not on the page`,
        );
      }
    });
  }

  test("/invasive lists the invasive animals with their public record counts", async () => {
    const [top] = await sql`
      select t.id, t.common_name_zh as zh, s.report_count as n
        from taxa t join species_report_stats s on s.taxon_id = t.id
       where t.is_invasive and t.kingdom = 'Animalia'
         and t.taxon_status is not distinct from 'accepted' and t.is_in_taiwan
         and t.rank in ('Species','Subspecies') and t.common_name_zh is not null
       order by s.report_count desc limit 1`;
    if (!top) return;
    const { html } = await page("/invasive");
    assert.match(html, new RegExp(`href="/species/${top.id}-[^"]*"`), "the top species is not linked");
    assert.ok(html.includes(top.zh));
  });

  test("the list never names a retired duplicate", async () => {
    // TaiCOL keeps 多線南蜥 Mabuya multifasciata as a deleted row beside the
    // accepted 多線真稜蜥. Listed, one animal would appear twice.
    const [retired] = await sql`
      select id from taxa
       where is_invasive and kingdom = 'Animalia' and taxon_status = 'deleted'
         and is_in_taiwan limit 1`;
    if (!retired) return;
    const { html } = await page("/invasive");
    assert.doesNotMatch(html, new RegExp(`href="/species/${retired.id}-`));
  });
});

describe("the mark on an invasive record", () => {
  test("the record page and the map's panel carry it; a native record does not", async () => {
    const [inv] = await sql`
      select id from reports_public where is_invasive and taxon_id is not null limit 1`;
    const [nat] = await sql`
      select id from reports_public where not is_invasive and taxon_id is not null limit 1`;
    if (!inv || !nat) return;
    // The title attribute, not the word: the whole catalogue rides in every
    // page's payload, so "入侵種" alone would be found on any page at all.
    const mark = `title="${attr(zh.badge.invasiveWhy)}"`;
    assert.ok((await page(`/reports/${inv.id}`)).html.includes(mark), "the record page lacks it");
    assert.ok(!(await page(`/reports/${nat.id}`)).html.includes(mark), "a native record has it");

    const panel = async (id) => (await fetch(`${BASE_URL}/api/reports/${id}`)).json();
    assert.equal((await panel(inv.id)).isInvasive, true);
    assert.equal((await panel(nat.id)).isInvasive, false);
  });

  test("the list carries it on invasive rows", async () => {
    if ((await count({ collection: "invasive" })) === 0) return;
    const { html } = await page("/reports?collection=invasive");
    assert.ok(html.includes(`title="${attr(zh.badge.invasiveWhy)}"`));
  });
});

describe("the list's collection filter", () => {
  test("an old group= link opens the collection it meant", async () => {
    // `sighting` is the wildlife collection's old name.
    const { html } = await page("/reports?group=sighting");
    assert.match(
      html,
      /<a[^>]*href="\/reports\?collection=wildlife"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/reports\?collection=wildlife"/,
      "the wildlife chip is not the current one",
    );
  });

  test("filtered, it holds what the collection holds", async () => {
    // The lede counts the whole view; the table is filtered. With the
    // invasive filter on, every row the page links must be an invasive record.
    const { html } = await page("/reports?collection=invasive");
    const ids = [...html.matchAll(/href="\/reports\/([0-9a-f-]{36})"/g)].map((m) => m[1]);
    if (!ids.length) return;
    const [row] = await sql`
      select count(*) filter (where not is_invasive)::int as outside
        from reports_public where id = any(${ids}::uuid[])`;
    assert.equal(row.outside, 0, "the invasive list shows a record outside the collection");
  });
});

describe("/stats by collection", () => {
  test("names each collection and links to its page", async () => {
    const { html } = await page("/en/stats");
    for (const c of ["roadkill", "invasive", "wildlife"]) {
      assert.ok(html.includes(`href="/en/${c}"`), `no link to /en/${c}`);
    }
    const n = await count({ collection: "invasive" });
    assert.ok(html.includes(n.toLocaleString("en")), "the invasive count is missing");
  });
});

describe("the sitemap", () => {
  test("lists the three collection pages in both languages", async () => {
    const xml = await (await fetch(`${BASE_URL}/sitemap.xml`)).text();
    for (const c of ["roadkill", "invasive", "wildlife"]) {
      assert.match(xml, new RegExp(`<loc>[^<]*/${c}</loc>`));
      assert.match(xml, new RegExp(`<loc>[^<]*/en/${c}</loc>`));
    }
  });
});
