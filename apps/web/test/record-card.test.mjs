/**
 * What a shared record looks like: its share card, its title and its
 * description, and what none of them may carry.
 *
 * A just-filed report shared to LINE previewed as the site's badge, and every
 * record page had the site's description. Each record now has a card of its
 * own (reports/[id]/opengraph-image.tsx) and a description of its own, from
 * lib/recordMeta.ts. The rules held here:
 *
 *   - the card answers 200 image/png and its alt text names the species;
 *   - a blurred record's card never shows the record's photo: two blurred
 *     records alike in everything but a photo get the same card, byte for
 *     byte, so the photo was never drawn and never fetched;
 *   - a record the public may not see gets the card a never-issued id gets,
 *     so the card is no oracle for which ids exist;
 *   - the description says what and when, says "blurred" when it is, and
 *     never prints a coordinate.
 *
 * Whether an exact record's card does show its photo needs Storage, which CI
 * does not run; that half was checked by hand against the local stack.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, BASE_URL, requireServer } from "./helpers.mjs";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const code = (...p) => read(...p).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const meta = (html, attr, name) =>
  decode(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html)?.[1] ?? "") || null;

/** The page's og:image, its alt, and its description. */
async function head(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  const html = await res.text();
  const og = meta(html, "property", "og:image");
  return {
    status: res.status,
    html,
    image: og ? new URL(og).pathname : null,
    alt: meta(html, "property", "og:image:alt"),
    description: meta(html, "name", "description"),
  };
}

async function card(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  return { status: res.status, type: res.headers.get("content-type"), bytes: Buffer.from(await res.arrayBuffer()) };
}

/**
 * Two cards that should be identical, compared once more if they are not:
 * each card fetches its font subset from Google, and a fetch that fails falls
 * back to the Latin card, so one slow request is a difference that is not
 * the card's.
 */
async function sameCards(a, b) {
  for (let i = 0; i < 2; i++) {
    const [x, y] = await Promise.all([card(a), card(b)]);
    assert.equal(x.status, 200, a);
    assert.equal(y.status, 200, b);
    if (x.bytes.equals(y.bytes)) return true;
  }
  return false;
}

/**
 * Where this build serves a record's card, for any id and locale: Next names
 * the route with a hash of its own (opengraph-image-ftq0w3/card), so the
 * address is read off a public record's page rather than written here.
 */
let template;
async function cardPath(locale, id) {
  if (!template) {
    const [r] = await sql`select id from reports_public order by id limit 1`;
    const { image } = await head(`/reports/${r.id}`);
    assert.ok(image, "a public record names no og:image");
    template = { id: r.id, image };
  }
  return template.image.replace(template.id, id).replace(/^\/[^/]+\//, `/${locale}/`);
}

/**
 * A published record, committed so the server can see it.
 *
 * Imported rather than filed here, though the card is the same for both: a
 * public report filed here opens the season goal (seasonOpen), and
 * page-headings.test.mjs waits for a moment with none, so each one this file
 * made would be a moment it could not find.
 */
async function published({ taxonId, photo = false }) {
  const [r] = await sql`
    insert into reports (category, location, location_public, observed_at, taxon_id,
                         taxon_source, status, source)
    values ('roadkill',
            st_setsrid(st_makepoint(120.912, 23.811), 4326)::geography,
            st_setsrid(st_makepoint(120.912, 23.811), 4326)::geography,
            '2026-10-01T03:00:00Z', ${taxonId}, 'imported', 'published', 'gbif')
    returning id, location_precision`;
  if (photo)
    await sql`
      insert into report_photos (report_id, storage_path, content_type)
      values (${r.id}, ${`test-card/${r.id}.webp`}, 'image/webp')`;
  return r;
}

describe("a record's share card", () => {
  test("answers 200 image/png, and its alt text names the species", async (t) => {
    if (!(await requireServer(t))) return;
    const [r] = await sql`
      select rp.id, t.common_name_zh as zh, t.scientific_name as sci
        from reports_public rp join taxa t on t.id = rp.taxon_id
       where rp.location_precision = 'exact' and t.common_name_zh is not null
       order by rp.id limit 1`;
    assert.ok(r, "the fixture has no named exact record");
    for (const [prefix, name] of [["", r.zh], ["/en", null]]) {
      const h = await head(`${prefix}/reports/${r.id}`);
      assert.equal(h.status, 200);
      assert.ok(h.image, `${prefix}/reports/${r.id} names no og:image`);
      assert.match(h.image, new RegExp(`/reports/${r.id}/opengraph-image`));
      const c = await card(h.image);
      assert.equal(c.status, 200, h.image);
      assert.equal(c.type, "image/png");
      assert.ok(c.bytes.length > 1000, "an empty card");
      // The English page names it in English where there is a name, and by
      // its binomial or its Chinese name otherwise: one of the three.
      if (name) assert.ok(h.alt?.includes(name), `alt is ${h.alt}`);
      else assert.ok(h.alt && h.alt !== "A wildlife record on Project FormosaWatch", `alt is ${h.alt}`);
    }
  });

  test("of a blurred record never carries its photo", async (t) => {
    if (!(await requireServer(t))) return;
    // 豹貓: protected, so blurred, wherever it is filed.
    const [taxon] = await sql`
      select id from taxa where scientific_name = 'Prionailurus bengalensis' and rank = 'Species' limit 1`;
    assert.ok(taxon, "the fixture lacks 豹貓");
    const withPhoto = await published({ taxonId: taxon.id, photo: true });
    const without = await published({ taxonId: taxon.id });
    try {
      assert.notEqual(withPhoto.location_precision, "exact");
      assert.ok(
        await sameCards(await cardPath("zh-TW", withPhoto.id), await cardPath("zh-TW", without.id)),
        "a blurred record's card differs with a photo: the photo was drawn",
      );
    } finally {
      await sql`delete from reports where id in (${withPhoto.id}, ${without.id})`;
    }
  });

  test("of a record the public cannot see is the card of an id never issued", async (t) => {
    if (!(await requireServer(t))) return;
    const [held] = await sql`
      insert into reports (category, location, location_public, observed_at, status, source, flagged_reason)
      values ('roadkill',
              st_setsrid(st_makepoint(120.95, 23.74), 4326)::geography,
              st_setsrid(st_makepoint(120.95, 23.74), 4326)::geography,
              now(), 'pending', 'user', 'no photo on a category that expects one')
      returning id`;
    try {
      for (const locale of ["zh-TW", "en"])
        assert.ok(
          await sameCards(await cardPath(locale, held.id), await cardPath(locale, crypto.randomUUID())),
          `${locale}: a held report's card says something a stranger's does not`,
        );
    } finally {
      await sql`delete from reports where id = ${held.id}`;
    }
  });

  test("reads only what the public view shows, and the photo only of an exact record", () => {
    const route = code("app", "[locale]", "(site)", "reports", "[id]", "opengraph-image.tsx");
    const lib = code("lib", "recordMeta.ts");
    // The summary comes from reports_public, as web_anon, and selects no place.
    const summary = lib.slice(lib.indexOf("export const publicRecordSummary"), lib.indexOf("export function blurKm"));
    assert.match(summary, /asPublic\(/);
    assert.match(summary, /from reports_public rp/);
    for (const banned of [/location_public/, /\bst_[xy]\b/, /\bnotes\b/, /rights_holder/, /geom_3857/])
      assert.doesNotMatch(summary, banned, String(banned));
    // The rule, and the photo read behind it.
    assert.match(lib, /return r\.locationPrecision === "exact";/);
    const photo = lib.slice(lib.indexOf("export async function cardPhoto"));
    assert.match(photo, /^[^]*?if \(!cardMayShowPhoto\(summary\)\) return null;/);
    // The card draws nothing it did not get from those two.
    assert.match(route, /r \? cardPhoto\(id, r\) : null,/);
    assert.equal(route.match(/cardPhoto\(/g)?.length, 1, "the photo is read somewhere else too");
    for (const banned of [/\bsql\b/, /asPublic/, /\blat\b/, /\blng\b/, /ReportMap|maplibre/i])
      assert.doesNotMatch(route, banned, String(banned));
  });
});

describe("a record's description", () => {
  test("says what and when, in the page's language", async (t) => {
    if (!(await requireServer(t))) return;
    const [r] = await sql`
      select rp.id, t.common_name_zh as zh
        from reports_public rp join taxa t on t.id = rp.taxon_id
       where rp.location_precision = 'exact' and t.common_name_zh is not null
       order by rp.id limit 1`;
    const site = (await head("/")).description;
    const zh = await head(`/reports/${r.id}`);
    assert.ok(zh.description?.includes(r.zh), `description is ${zh.description}`);
    assert.match(zh.description, /\d{4}年\d{1,2}月\d{1,2}日在臺灣的/);
    assert.notEqual(zh.description, site);
    const en = await head(`/en/reports/${r.id}`);
    assert.match(en.description ?? "", /recorded in Taiwan on /);
  });

  test("says when a record is blurred, and never where it is", async (t) => {
    if (!(await requireServer(t))) return;
    const [r] = await sql`
      select id, st_y(location_public::geometry) as lat, st_x(location_public::geometry) as lng,
             location_precision as p
        from reports_public where is_obscured and taxon_id is not null
       order by id limit 1`;
    assert.ok(r, "the fixture has no blurred record");
    const km = r.p === "coarse_50km" ? 50 : 10;
    for (const [prefix, words] of [["", `位置已模糊至約 ${km} 公里`], ["/en", `blurred to about ${km} km`]]) {
      const h = await head(`${prefix}/reports/${r.id}`);
      assert.ok(h.description?.includes(words), `${prefix}: description is ${h.description}`);
      for (const n of [r.lat, r.lng])
        for (const digits of [n.toFixed(1), n.toFixed(2), n.toFixed(3), String(Math.trunc(n * 10) / 10)])
          assert.ok(!h.description.includes(digits), `${prefix}: the description prints ${digits}`);
      assert.ok(!h.alt?.includes(String(r.lat).slice(0, 5)), "the card's alt text prints a coordinate");
    }
  });
});
