/**
 * What a species page and a record page lead with.
 *
 * A record page was titled by the kind of report ("Roadkill") with the animal
 * in a card below; the animal now heads the page when someone has named it.
 * A species page's only call to action was a 12px outlined pill at its foot;
 * it is now a full-width button in the report orange. And /stats linked the
 * season goal that every other page keeps unlisted until a report comes in.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { sql, BASE_URL } from "./helpers.mjs";

after(() => sql.end());

async function server() {
  return (await fetch(BASE_URL).catch(() => null)) !== null;
}
const html = async (path) => (await fetch(`${BASE_URL}${path}`, { redirect: "follow" })).text();

describe("a record page", () => {
  test("is headed by the animal when it is named, in both languages", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const [r] = await sql`
      select rp.id, t.common_name_zh as zh, t.common_name_en as en
        from reports_public rp join taxa t on t.id = rp.taxon_id
       where t.common_name_zh is not null and t.common_name_en is not null
       limit 1`;
    if (!r) return t.skip("no named record with both names");
    const zh = (await html(`/reports/${r.id}`)).match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    const en = (await html(`/en/reports/${r.id}`)).match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    assert.ok(zh.includes(r.zh), "the Chinese page's heading names the animal");
    assert.ok(en.includes(r.en.replace(/'/g, "&#x27;")), "the English page's heading names the animal");
  });

  test("with no species, is headed by what was reported", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const [r] = await sql`select id from reports_public where taxon_id is null limit 1`;
    if (!r) return t.skip("no unidentified public record");
    const h1 = (await html(`/en/reports/${r.id}`)).match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    assert.match(h1, /Roadkill|Injured|Invasive|Sighting/i);
  });
});

describe("a species page", () => {
  test("ends with one full-width report button, whether or not it has records", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const [withRecords] = await sql`
      select s.taxon_id as id from species_report_stats s join taxa t on t.id = s.taxon_id
       where t.sensitivity is distinct from '座標不開放' and t.rank = 'Species'
         and t.taxon_status = 'accepted' and t.is_in_taiwan
       order by s.report_count desc limit 1`;
    const [without] = await sql`
      select t.id from taxa t left join species_report_stats s on s.taxon_id = t.id
       where s.taxon_id is null and t.rank = 'Species' and t.taxon_status = 'accepted'
         and t.is_in_taiwan and t.kingdom = 'Animalia' and t.sensitivity is null limit 1`;
    for (const row of [withRecords, without].filter(Boolean)) {
      const page = await html(`/en/species/${row.id}`);
      const button = page.match(new RegExp(`<a[^>]*href="/en/report\\?taxonId=${row.id}"[^>]*>`))?.[0];
      assert.ok(button, `species ${row.id} offers to report it`);
      assert.match(button, /w-full/);
      assert.match(button, /bg-ember-500/);
      assert.match(button, /text-ink-950/, "dark text on the orange");
    }
  });
});

describe("/stats", () => {
  test("does not link the season goal while no one has filed a report", async (t) => {
    if (!(await server())) return t.skip(`no server at ${BASE_URL}`);
    const [{ n }] = await sql`select count(*)::int as n from reports_public where source = 'user'`;
    if (n > 0) return t.skip("a person has filed a report here");
    assert.doesNotMatch(await html("/en/stats"), /href="\/en\/season"/);
  });
});
