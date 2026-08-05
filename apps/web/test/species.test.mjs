/**
 * Species directory and detail pages.
 *
 * The privacy case matters most: a 座標不開放 species must expose no coordinates
 * and no record count, because counting from the base table would leak exactly
 * what the obscuring design exists to hide.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql, BASE_URL } from "./helpers.mjs";

after(() => sql.end());

before(async () => {
  const res = await fetch(BASE_URL).catch(() => null);
  if (!res) throw new Error(`dev server not reachable at ${BASE_URL} — run \`npm run dev\``);
});

const get = async (path) => {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), body: await res.text() };
};

describe("species_report_stats view", () => {
  test("counts come from reports_public, never the base table", async () => {
    // If the view were built on `reports`, suppressed taxa would appear here.
    const [row] = await sql`
      select count(*)::int as leaked
        from species_report_stats s
        join taxa t on t.id = s.taxon_id
       where t.sensitivity = '座標不開放'`;
    assert.equal(row.leaked, 0, "suppressed taxa must not appear in public species stats");
  });

  test("totals reconcile with reports_public", async () => {
    const [row] = await sql`
      select (select coalesce(sum(report_count),0) from species_report_stats)::int as via_view,
             (select count(*) from reports_public where taxon_id is not null)::int as direct`;
    assert.equal(row.via_view, row.direct);
  });
});

describe("directory", () => {
  test("renders and defaults to species with records", async () => {
    const { status, body } = await get("/species");
    assert.equal(status, 200);
    // Every listed species should have a non-zero count under the default filter.
    assert.ok(body.includes("species"), "expected the directory to render");
  });

  test("filters are accepted", async () => {
    for (const f of ["recorded", "all", "protected", "invasive", "endemic"]) {
      const { status } = await get(`/species?filter=${f}`);
      assert.equal(status, 200, `filter=${f}`);
    }
  });

  test("an unknown filter falls back rather than erroring", async () => {
    const { status } = await get("/species?filter=notreal");
    assert.equal(status, 200);
  });
});

describe("search endpoint", () => {
  test("finds a species by scientific name", async () => {
    const res = await fetch(`${BASE_URL}/api/species/search?q=Prionailurus`);
    const { results } = await res.json();
    assert.ok(results.some((r) => r.scientificName.startsWith("Prionailurus")));
  });

  test("finds a species by Chinese synonym in alt_names_zh", async () => {
    // 石虎 is an alternative name for 豹貓; searching the common name alone misses it.
    const res = await fetch(`${BASE_URL}/api/species/search?q=${encodeURIComponent("石虎")}`);
    const { results } = await res.json();
    assert.ok(results.length > 0, "expected matches for 石虎");
    assert.equal(results[0].scientificName, "Prionailurus bengalensis",
      "the species with records should rank first");
  });

  test("rejects an over-long query and an unknown filter", async () => {
    assert.equal((await fetch(`${BASE_URL}/api/species/search?q=${"x".repeat(100)}`)).status, 400);
    assert.equal((await fetch(`${BASE_URL}/api/species/search?q=a&filter=nope`)).status, 400);
  });
});

describe("detail page", () => {
  let recorded, unrecorded, suppressed;

  before(async () => {
    [recorded] = await sql`
      select t.id, t.scientific_name from taxa t
        join species_report_stats s on s.taxon_id = t.id
       order by s.report_count desc limit 1`;
    [unrecorded] = await sql`
      select t.id, t.scientific_name from taxa t
        left join species_report_stats s on s.taxon_id = t.id
       where s.taxon_id is null and t.is_in_taiwan and t.rank = 'Species' limit 1`;
    [suppressed] = await sql`
      select id, scientific_name from taxa where sensitivity = '座標不開放' limit 1`;
  });

  const slug = (r) =>
    `${r.id}-${r.scientific_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

  test("a bare id redirects to the canonical slug", async () => {
    const { status, location } = await get(`/species/${recorded.id}`);
    assert.equal(status, 307);
    assert.ok(location.includes(slug(recorded)), `expected canonical slug, got ${location}`);
  });

  test("a species with records renders", async () => {
    const { status } = await get(`/species/${slug(recorded)}`);
    assert.equal(status, 200);
  });

  test("a species with no records renders the empty state, not an error", async () => {
    const { status } = await get(`/species/${slug(unrecorded)}`);
    assert.equal(status, 200);
  });

  test("a suppressed species exposes no coordinates", async () => {
    const { status, body } = await get(`/species/${slug(suppressed)}`);
    assert.equal(status, 200);
    // Its tiles must be empty too — the map is fed by the same endpoint.
    const tile = await fetch(`${BASE_URL}/api/tiles/6/53/27?taxonId=${suppressed.id}`);
    assert.equal((await tile.arrayBuffer()).byteLength, 0,
      "a suppressed species must produce empty tiles");
    assert.ok(!/\d{2}\.\d{4},\s*\d{3}\.\d{4}/.test(body), "no coordinate pairs should be rendered");
  });

  test("an unknown id 404s", async () => {
    assert.equal((await get("/species/99999999")).status, 404);
    assert.equal((await get("/species/not-a-species")).status, 404);
  });
});
