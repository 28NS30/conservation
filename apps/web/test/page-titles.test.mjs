/**
 * What a tab, a bookmark and a shared link are called.
 *
 * Four pages had no title of their own, so each read as the bare site name:
 * the map (the busiest page), the sign-in page, every record page, and — worse
 * than none — a record id that does not exist, which was titled "Received. Not
 * public right now." over a page saying "Page not found". And the 404 for an
 * unmatched URL answered English readers in Chinese.
 *
 * None of this breaks a build or a status code. It is read against the running
 * server, in both languages.
 *
 *   TEST_BASE_URL=http://localhost:3000 node --test test/page-titles.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql, BASE_URL } from "./helpers.mjs";

after(() => sql.end());

const page = async (path) => {
  const res = await fetch(`${BASE_URL}${path}`);
  const html = await res.text();
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  return { status: res.status, html, title: title.replace(/&amp;/g, "&") };
};

describe("pages with a title of their own", () => {
  for (const [path, want] of [
    ["/map", /^地圖 · /],
    ["/en/map", /^Map · /],
    ["/login", /^登入 · /],
    ["/en/login", /^Sign in · /],
  ])
    test(path, async () => {
      const { status, title } = await page(path);
      assert.equal(status, 200);
      assert.match(title, want);
    });
});

describe("a record page", () => {
  test("is titled by what was seen and when, with no invented time", async () => {
    // An imported record: GBIF gives a date and no time, stored as midnight UTC,
    // and the page used to print that as 08:00 Taipei.
    const [r] = await sql`
      select rp.id, t.common_name_zh as zh, t.scientific_name as sci
        from reports_public rp join taxa t on t.id = rp.taxon_id
       where rp.source = 'gbif' and t.common_name_zh is not null
       limit 1`;
    const zh = await page(`/reports/${r.id}`);
    const en = await page(`/en/reports/${r.id}`);
    assert.equal(zh.status, 200);
    assert.ok(zh.title.startsWith(`${r.zh} · `), `zh title is "${zh.title}"`);
    assert.ok(en.title.startsWith(`${r.sci} · `), `en title is "${en.title}"`);
    for (const { html, title } of [zh, en]) {
      assert.doesNotMatch(title, /\d:\d\d/, "a date-only record's title carries a time");
      assert.doesNotMatch(html, /上午8:00|8:00:00\s*AM/, "the invented 08:00 is back");
    }
  });

  test("an id that is not public gets a neutral title, not a receipt's", async () => {
    // A mistyped id is not a receipt, so the title says nothing the status code
    // does not. It used to say "Received" to it.
    //
    // Read from the streamed payload, not the <title> tag: on a 404 the tag
    // holds the layout's default, and the page's own title arrives later in
    // the document, which is what a browser puts in the tab. That is how a
    // headless browser saw "Received. Not public right now." over "Page not
    // found" in the first place. Matched with the site name after it, because
    // the whole catalogue is also in the page, receipt wording included.
    for (const [prefix, site, neutral, receipt] of [
      ["", "福爾摩沙守望計畫", "無法顯示這筆紀錄", "收到了，目前沒有公開"],
      ["/en", "Project FormosaWatch", "This record isn't available", "Received. Not public right now."],
    ]) {
      const { status, html } = await page(`${prefix}/reports/${crypto.randomUUID()}`);
      assert.equal(status, 404);
      assert.ok(html.includes(`${neutral} · ${site}`), `${prefix || "/"}: the neutral title is missing`);
      assert.ok(!html.includes(`${receipt} · ${site}`), `${prefix || "/"}: a mistyped id is titled as a receipt`);
    }
  });

  test("a held report's receipt is titled as the receipt it shows", async () => {
    // The page says "Received. Not public right now." to anyone holding the id
    // of a pending report; a tab saying "This record isn't available" above it
    // contradicted the heading. Titling it the same hides nothing the page
    // does not already say, and it stays out of search results.
    //
    // A held report of the kind the form produces with no photo, committed
    // because the assertion is about what the running server serves.
    const [row] = await sql`
      insert into reports (category, location, location_public, observed_at,
                           status, source, flagged_reason)
      values ('roadkill',
              st_setsrid(st_makepoint(120.95, 23.74), 4326)::geography,
              st_setsrid(st_makepoint(120.95, 23.74), 4326)::geography,
              now(), 'pending', 'user', 'no photo on a category that expects one')
      returning id`;
    try {
      for (const [prefix, site, receipt] of [
        ["", "福爾摩沙守望計畫", "收到了，目前沒有公開"],
        ["/en", "Project FormosaWatch", "Received. Not public right now."],
      ]) {
        const { status, title, html } = await page(`${prefix}/reports/${row.id}`);
        assert.equal(status, 200);
        assert.equal(title, `${receipt} · ${site}`, `${prefix || "/"}: title is "${title}"`);
        assert.match(html, /<meta name="robots" content="noindex/);
      }
    } finally {
      await sql`delete from reports where id = ${row.id}::uuid`;
    }
  });
});

describe("the 404 for a URL no route serves", () => {
  test("answers in both languages, each with its own way home", async () => {
    for (const path of ["/no-such-page-exists-here", "/en/no-such-page-exists-here"]) {
      const { status, html } = await page(path);
      assert.equal(status, 404, path);
      assert.match(html, /找不到這個頁面/, `${path}: no Chinese heading`);
      assert.match(html, /Page not found/, `${path}: no English heading`);
      // Chinese buttons to the Chinese site, English buttons to the English
      // one: an English reader who mistyped a letter could not read the way out.
      assert.match(html, /<a href="\/"[^>]*>回首頁<\/a>/);
      assert.match(html, /<a href="\/en"[^>]*>Home<\/a>/);
      assert.match(html, /<section lang="en"/, "the English half is not marked as English");
    }
  });
});
