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
  if (!res)
    throw new Error(
      `dev server not reachable at ${BASE_URL} — run \`npm run dev\``,
    );
});

const get = async (path) => {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  return {
    status: res.status,
    location: res.headers.get("location"),
    body: await res.text(),
  };
};

describe("species_report_stats view", () => {
  test("counts come from reports_public, never the base table", async () => {
    // If the view were built on `reports`, suppressed taxa would appear here.
    const [row] = await sql`
      select count(*)::int as leaked
        from species_report_stats s
        join taxa t on t.id = s.taxon_id
       where t.sensitivity = '座標不開放'`;
    assert.equal(
      row.leaked,
      0,
      "suppressed taxa must not appear in public species stats",
    );
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
    const res = await fetch(
      `${BASE_URL}/api/species/search?q=${encodeURIComponent("石虎")}`,
    );
    const { results } = await res.json();
    assert.ok(results.length > 0, "expected matches for 石虎");
    assert.equal(
      results[0].scientificName,
      "Prionailurus bengalensis",
      "the species with records should rank first",
    );
  });

  test("rejects an over-long query and an unknown filter", async () => {
    assert.equal(
      (await fetch(`${BASE_URL}/api/species/search?q=${"x".repeat(100)}`))
        .status,
      400,
    );
    assert.equal(
      (await fetch(`${BASE_URL}/api/species/search?q=a&filter=nope`)).status,
      400,
    );
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
    `${r.id}-${r.scientific_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;

  test("a bare id redirects to the canonical slug", async () => {
    const { status, location } = await get(`/species/${recorded.id}`);
    assert.equal(status, 307);
    assert.ok(
      location.includes(slug(recorded)),
      `expected canonical slug, got ${location}`,
    );
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
    const tile = await fetch(
      `${BASE_URL}/api/tiles/6/53/27?taxonId=${suppressed.id}`,
    );
    assert.equal(
      (await tile.arrayBuffer()).byteLength,
      0,
      "a suppressed species must produce empty tiles",
    );
    assert.ok(
      !/\d{2}\.\d{4},\s*\d{3}\.\d{4}/.test(body),
      "no coordinate pairs should be rendered",
    );
  });

  test("an unknown id 404s", async () => {
    assert.equal((await get("/species/99999999")).status, 404);
    assert.equal((await get("/species/not-a-species")).status, 404);
  });
});

describe("thin species pages", () => {
  /*
   * 458 taxa have records; 124,980 do not. Those pages carry a name, a rank and
   * an empty map, and a crawler that finds a hundred thousand near-identical
   * thin pages forms a view of the whole domain from them.
   *
   * They must stay reachable — the directory links them and search finds them —
   * so this pins the distinction rather than their existence.
   */
  test("a protected plant is not rendered as a wildlife level", async () => {
    // protected_status holds two statutes. I/II/III are levels under 野生動物保育法,
    // which covers animals only; "1" marks a plant designated under 文化資產保存法.
    // Interpolating it produced "Protected 1" — meaningless, and wrong about
    // which law applies.
    const [plant] = await sql`
      select id from taxa where protected_status = '1' limit 1`;
    assert.ok(plant, "expected a protected plant fixture");
    const html = await (
      await fetch(`${BASE_URL}/en/species/${plant.id}`)
    ).text();
    assert.match(html, /Cultural Heritage Preservation Act/);
    assert.ok(
      !/Protected\s*(·\s*)?1\b/.test(html),
      "a plant must never render as wildlife protection level 1",
    );
  });

  test("a split CITES listing renders one chip per appendix, and never NC", async () => {
    // Ten Taiwan species carry values like I/II or II/NC. A slash is a split
    // listing — different populations in different appendices — not a single
    // code, and the badge used to print the raw string. NC is not an appendix
    // at all; it marks a taxon listed in none of them.
    const [split] = await sql`
      select id, cites from taxa
       where cites like '%/%' and is_in_taiwan
       order by id limit 1`;
    assert.ok(split, "expected a split-listed CITES fixture");
    const html = await (
      await fetch(`${BASE_URL}/en/species/${split.id}`)
    ).text();
    assert.ok(
      !/CITES\s+[IV]+\//.test(html),
      "the raw slashed code must not be printed",
    );
    // Derived from the row, not hardcoded. The first split-listed species is
    // II/NC in one dataset and I/II in another, and "Appendix I" is a prefix of
    // "Appendix II" — so a fixed expectation is wrong in two separate ways.
    for (const part of split.cites.split("/")) {
      const chip = `CITES Appendix ${part}<`;
      if (["I", "II", "III"].includes(part)) {
        assert.ok(html.includes(chip), `expected a chip for appendix ${part}`);
      } else {
        assert.ok(!html.includes(chip), `${part} is not an appendix`);
      }
    }

    const [nc] = await sql`
      select id from taxa where cites = 'NC' and is_in_taiwan limit 1`;
    if (nc) {
      const ncHtml = await (
        await fetch(`${BASE_URL}/en/species/${nc.id}`)
      ).text();
      // Not /CITES/ alone: every page inlines the whole message catalogue, so
      // the word appears whether or not a chip was rendered. "CITES Appendix"
      // is contiguous only once a chip has been built from the template.
      assert.ok(
        !/CITES Appendix/.test(ncHtml),
        "a taxon in no appendix must carry no CITES chip",
      );
    }
  });

  test("conservation codes are rendered as words, not codes", async () => {
    const [row] = await sql`
      select id from taxa where iucn = 'VU' and is_in_taiwan limit 1`;
    assert.ok(row, "expected an IUCN VU fixture");
    const en = await (await fetch(`${BASE_URL}/en/species/${row.id}`)).text();
    assert.match(en, /IUCN Vulnerable/);
    const zh = await (await fetch(`${BASE_URL}/species/${row.id}`)).text();
    // Taiwan writes 易危; 近危/無危 are mainland renderings and must not appear.
    assert.match(zh, /IUCN 易危/);
  });

  test("a page with nothing distinguishing is noindex", async () => {
    // No records, no conservation assessment, not endemic or invasive, and no
    // Chinese synonyms — a name, an authority and a lineage, which 41,958
    // species share the shape of.
    const [bare] = await sql`
      select t.id from taxa t
        left join species_report_stats s on s.taxon_id = t.id
       where s.taxon_id is null
         and t.rank = 'Species' and t.is_in_taiwan
         and t.protected_status is null and t.iucn is null
         and t.redlist is null and t.cites is null
         and not t.is_endemic and not t.is_invasive
         and (t.alt_names_zh is null or cardinality(t.alt_names_zh) = 0)
       limit 1`;
    assert.ok(bare, "expected at least one undistinguished species");
    const html = await (await fetch(`${BASE_URL}/species/${bare.id}`)).text();
    assert.match(html, /<meta name="robots" content="noindex/);
  });

  test("a species with records is indexable", async () => {
    const [{ id }] = await sql`
      select taxon_id as id from species_report_stats order by report_count desc limit 1`;
    const html = await (await fetch(`${BASE_URL}/species/${id}`)).text();
    assert.ok(!/<meta name="robots" content="noindex/.test(html));
  });

  test("a conservation status alone makes a page indexable", async () => {
    // The rule this pins: the page renders four assessment schemes from the
    // checklist, none of which needs anyone to have reported anything. Under
    // the old reportCount test, every one of these 12,008 pages was hidden.
    const [row] = await sql`
      select t.id from taxa t
        left join species_report_stats s on s.taxon_id = t.id
       where s.taxon_id is null
         and t.rank = 'Species' and t.is_in_taiwan
         and t.protected_status is not null
       limit 1`;
    assert.ok(row, "expected a protected species with no records");
    const html = await (await fetch(`${BASE_URL}/species/${row.id}`)).text();
    assert.ok(
      !/<meta name="robots" content="noindex/.test(html),
      "a protected species must be indexable even with no records",
    );
  });
});
