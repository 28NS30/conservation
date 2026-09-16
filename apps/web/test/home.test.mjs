import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql, BASE_URL } from "./helpers.mjs";

/**
 * The front page, as the owner asked for it in September 2026: a much larger
 * badge with only a little text beside it, and no picture of the record count.
 */
after(() => sql.end());

// Node's fetch sends no Accept-Language, so "/" renders the default locale.
const page = async (path) => {
  const res = await fetch(`${BASE_URL}${path}`);
  return { status: res.status, html: await res.text() };
};

/** Mirrors MAP_PLACES in app/[locale]/page.tsx. If one moves, move both. */
const MAP_PLACES = [
  { key: "yangmingshan", lng: 121.55, lat: 25.17 },
  { key: "taichung", lng: 120.68, lat: 24.15 },
  { key: "hualien", lng: 121.6, lat: 23.98 },
  { key: "kenting", lng: 120.8, lat: 21.95 },
];

describe("the front page", () => {
  test("opens with the name and one line, then the three doors", async () => {
    const { status, html } = await page("/");
    assert.equal(status, 200);
    assert.match(html, /福爾摩沙/);
    assert.match(html, /臺灣的公開野生動物紀錄，任何人都能補上一筆。/);
    assert.equal(html.match(/href="\/report\?category=/g)?.length, 3);
    // The badge is the largest thing above the fold. Next marks a priority
    // image with a preload for the sizes it is actually drawn at, so a phone
    // fetches a phone-sized badge before the page has laid out.
    assert.match(
      html,
      /<link rel="preload" as="image"[^>]*brand-badge[^>]*imageSizes="\(min-width: 1024px\) 320px/,
      "the badge must be preloaded at its drawn sizes",
    );
  });

  test("the island plate is gone, and so is the route that drew it", async () => {
    const { html } = await page("/");
    assert.ok(!html.includes('src="/field.svg"'), "no plate image");
    assert.equal((await fetch(`${BASE_URL}/field.svg`)).status, 404);
  });

  test("offers ways into the map, by animal and by place", async () => {
    const { html } = await page("/");
    assert.ok((html.match(/href="\/map\?taxonId=\d+"/g) ?? []).length >= 1);
    assert.equal(html.match(/href="\/map\?lng=[\d.]+&amp;lat=[\d.]+&amp;z=11"/g)?.length, 4);
    assert.match(html, /href="\/map"/);
  });

  test("in English, the Chinese name is still marked as Chinese", async () => {
    const { status, html } = await page("/en");
    assert.equal(status, 200);
    assert.match(html, /Taiwan&#x27;s open wildlife record|Taiwan's open wildlife record/);
    assert.match(html, /<h1[^>]*>.*?lang="zh-TW"/s);
  });

  test("the animals offered are common, named, and not sensitive", async () => {
    // Asserted on what the page actually links, not by re-running the page's
    // query: a test that copied the query would keep passing if the sensitivity
    // filter were dropped from both. A front-page button leading straight to
    // where a sensitive animal is found would be a strange thing to build,
    // blurred or not.
    const { html } = await page("/");
    const ids = [...html.matchAll(/href="\/map\?taxonId=(\d+)"/g)].map((m) => Number(m[1]));
    assert.equal(ids.length, 3, "three animals");
    const rows = await sql`
      select id, sensitivity, protected_status, common_name_zh
        from taxa where id = any(${ids})`;
    assert.equal(rows.length, 3);
    for (const r of rows) {
      assert.equal(r.sensitivity, null, `taxon ${r.id} is rated sensitive`);
      assert.equal(r.protected_status, null, `taxon ${r.id} is protected`);
      assert.ok(r.common_name_zh, `taxon ${r.id} has no Chinese name to show`);
    }
  });

  test("every place offered opens on a view with records in it", async () => {
    for (const p of MAP_PLACES) {
      const [{ n }] = await sql`
        select count(*)::int as n from reports_public
         where st_x(location_public::geometry) between ${p.lng - 0.2} and ${p.lng + 0.2}
           and st_y(location_public::geometry) between ${p.lat - 0.15} and ${p.lat + 0.15}`;
      assert.ok(n > 0, `${p.key} would open on an empty map`);
    }
  });
});

describe("the anniversary ledger", () => {
  test("matches calendar dates, not day numbers", async () => {
    // Day numbers were wrong twice: a straight difference put 30 December and
    // 1 January 363 days apart, and a leap year shifts every day number after
    // 28 February by one. Pinned at source, because a live query only shows the
    // first bug in the first and last week of the year.
    const { readFileSync } = await import("node:fs");
    const stats = readFileSync(new URL("../lib/stats.ts", import.meta.url), "utf8");
    const ledger = stats.slice(stats.indexOf("export async function anniversaryLedger"));
    assert.match(ledger, /to_char\(r\.observed_at, 'MM-DD'\) in \(/);
    assert.doesNotMatch(ledger, /extract\(doy/, "day-of-year arithmetic must not return");

    // The same window, built for New Year's Day, crosses the year cleanly.
    const rows = await sql`
      select to_char(d, 'MM-DD') as md
        from generate_series('2027-01-01'::date - 3, '2027-01-01'::date + 3, interval '1 day') d`;
    assert.deepEqual(
      rows.map((r) => r.md),
      ["12-29", "12-30", "12-31", "01-01", "01-02", "01-03", "01-04"],
    );
  });
});
