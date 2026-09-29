/**
 * Three report pages, and the rules each one holds a report to.
 *
 * The team asked for a page per kind of report (requests 3 and 9): roadkill,
 * invasive species, wildlife sighting. These pin what that split must never
 * lose: every old link still lands somewhere sensible, the server holds a
 * submission to the page it came from — a native animal cannot be filed from
 * the invasive page, a live sighting cannot be filed from the roadkill page —
 * and a report from the invasive page stays blurred to at least 10 km,
 * however it is later named.
 *
 * Reports are POSTed for real — the API holds its own connection, so a
 * transaction here could not see them — and deleted by client nonce
 * afterwards. None carries a photograph, so every one is held `pending` and
 * none reaches the public view the tile tests count.
 *
 *   TEST_BASE_URL=http://localhost:3000 node --test test/report-pages.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATEGORY_KEYS,
  REPORT_GROUPS,
  REPORT_GROUP_KEYS,
  REPORT_PAGES,
  REPORT_PAGE_KEYS,
  legacyReportPage,
  pageAllows,
  pageOf,
  reportSubmissionSchema,
} from "@conservation/shared";
import { awaitingVerification } from "../lib/report/verification.ts";
import { errorKey, slotOf } from "../lib/report/errors.ts";
import { BASE_URL, sql, inRollback, insertReport } from "./helpers.mjs";

const nonces = [];
after(async () => {
  if (nonces.length)
    await sql`delete from reports where client_nonce = any(${nonces})`;
  await sql.end();
});

/** A row by TaiCOL id, which the CI fixture carries (supabase/seed-test.sql). */
async function taxon(taicolId) {
  const [t] = await sql`select id from taxa where taicol_id = ${taicolId}`;
  assert.ok(t, `${taicolId} should be in taxa (local copy or the CI fixture)`);
  return t.id;
}
const TOAD = "t0028758"; // 黑眶蟾蜍, native
const SKINK = "t0029144"; // 多線真稜蜥, invasive, unrated
const YEW = "t0052582"; // 臺灣穗花杉, a plant

async function submit(body) {
  // Several reports in a few seconds from one address is exactly what the
  // burst limit exists to stop; rate limiting has its own coverage.
  await sql`delete from rate_limits where key like 'submit-%'`;
  const clientNonce = randomUUID();
  nonces.push(clientNonce);
  const res = await fetch(`${BASE_URL}/api/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lng: 120.9,
      lat: 23.8,
      observedAt: new Date().toISOString(),
      photoPaths: [],
      clientNonce,
      ...body,
    }),
  });
  const [row] = await sql`
    select category, taxon_id, precision_override, location_precision
      from reports where client_nonce = ${clientNonce}`;
  return { status: res.status, body: await res.json(), row };
}

describe("the pages, in packages/shared", () => {
  test("every stored category is filed from exactly one page", () => {
    for (const c of CATEGORY_KEYS) {
      const pages = REPORT_PAGE_KEYS.filter((p) => pageAllows(p, c));
      assert.equal(pages.length, 1, `${c} is filed from ${pages.join(", ") || "no page"}`);
      assert.equal(pageOf(c), pages[0]);
    }
    assert.deepEqual(Object.keys(REPORT_PAGES).sort(), [...REPORT_PAGE_KEYS].sort());
  });

  test("the pages file what the team asked for", () => {
    assert.deepEqual(REPORT_PAGES.roadkill.categories, ["roadkill", "injured"]);
    assert.deepEqual(REPORT_PAGES.invasive.categories, ["invasive"]);
    assert.deepEqual(REPORT_PAGES.wildlife.categories, ["sighting"]);
    // Animals everywhere; invasive ones only, on the invasive page.
    for (const p of REPORT_PAGE_KEYS)
      assert.equal(REPORT_PAGES[p].species.kingdom, "Animalia", p);
    assert.equal(REPORT_PAGES.invasive.species.invasiveOnly, true);
    assert.equal(REPORT_PAGES.roadkill.species.invasiveOnly, false);
    assert.equal(REPORT_PAGES.wildlife.species.invasiveOnly, false);
  });

  test("the map's groups are the pages under their older names, unchanged", () => {
    // Another part of the site filters by these, and URLs carry the keys.
    assert.deepEqual(REPORT_GROUP_KEYS, ["invasive", "sighting", "roadkill"]);
    assert.deepEqual(REPORT_GROUPS.invasive.categories, ["invasive"]);
    assert.deepEqual(REPORT_GROUPS.sighting.categories, ["sighting"]);
    assert.deepEqual(REPORT_GROUPS.roadkill.categories, ["roadkill", "injured"]);
  });

  test("an old ?category= names a page, and anything else names none", () => {
    assert.equal(legacyReportPage("roadkill"), "roadkill");
    assert.equal(legacyReportPage("injured"), "roadkill");
    assert.equal(legacyReportPage("invasive"), "invasive");
    assert.equal(legacyReportPage("sighting"), "wildlife");
    for (const bad of ["dragons", "wildlife", "", undefined, null, "__proto__"])
      assert.equal(legacyReportPage(bad), null, String(bad));
  });

  test("the submission may say which page it came from, and only a real one", () => {
    const base = {
      category: "sighting",
      lng: 120.9,
      lat: 23.8,
      observedAt: new Date().toISOString(),
      clientNonce: randomUUID(),
    };
    assert.ok(reportSubmissionSchema.safeParse(base).success, "page is optional");
    assert.ok(reportSubmissionSchema.safeParse({ ...base, page: "wildlife" }).success);
    assert.ok(!reportSubmissionSchema.safeParse({ ...base, page: "sighting" }).success);
  });
});

describe("old links", () => {
  const go = (path) => fetch(`${BASE_URL}${path}`, { redirect: "manual" });

  for (const [prefix, lang] of [["", "zh-TW"], ["/en", "en"]])
    test(`?category= goes to its page with a 307, keeping the species (${lang})`, async () => {
      for (const [category, kind] of [
        ["roadkill", "roadkill"],
        ["injured", "roadkill"],
        ["invasive", "invasive"],
        ["sighting", "wildlife"],
      ]) {
        const res = await go(`${prefix}/report?category=${category}&taxonId=28758&ref=home`);
        assert.equal(res.status, 307, `${category}: a temporary redirect, never a permanent one`);
        const to = new URL(res.headers.get("location"), BASE_URL);
        assert.equal(to.pathname, `${prefix}/report/${kind}`, category);
        // The species and nothing else: whatever else rode along on an old
        // link was about the old form.
        assert.equal(to.search, "?taxonId=28758", category);

        const bare = await go(`${prefix}/report?category=${category}`);
        assert.equal(new URL(bare.headers.get("location"), BASE_URL).search, "");
      }
    });

  test("a value that never named a category is a mistyped link, not an error", async () => {
    const res = await go("/report?category=dragons");
    assert.equal(res.status, 200, "the chooser, not a redirect and not a 404");
  });

  test("nothing on the site still links the old way", async () => {
    for (const path of ["/", "/en", "/report", "/report/roadkill", "/about"]) {
      const html = await (await fetch(`${BASE_URL}${path}`)).text();
      assert.doesNotMatch(html, /href="[^"]*\/report\?category=/, path);
    }
  });
});

describe("the chooser", () => {
  // The chooser's own cards, not the header menu's links to the same pages.
  const kinds = (html) =>
    [
      ...html.matchAll(
        /<a class="group [^"]*"[^>]*href="((?:\/en)?\/report\/(?:roadkill|invasive|wildlife)[^"]*)"/g,
      ),
    ].map((m) => m[1].replace(/&amp;/g, "&"));

  test("offers the three pages, in the team's order", async () => {
    const zh = await (await fetch(`${BASE_URL}/report`)).text();
    assert.deepEqual(kinds(zh), ["/report/roadkill", "/report/invasive", "/report/wildlife"]);
    const en = await (await fetch(`${BASE_URL}/en/report`)).text();
    assert.deepEqual(kinds(en), ["/en/report/roadkill", "/en/report/invasive", "/en/report/wildlife"]);
  });

  test("in the home page's words, so the two cannot disagree", async () => {
    const zh = await (await fetch(`${BASE_URL}/report`)).text();
    const home = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "messages", "zh-TW.json"), "utf8"),
    ).home;
    for (const key of ["Roadkill", "Invasive", "Sighting"])
      for (const part of ["Title", "Cta"])
        assert.ok(zh.includes(home[`row${key}${part}`]), `row${key}${part}`);
  });

  test("a species carries on only to the pages that take it", async () => {
    // The toad is native: the invasive page does not take it, so that
    // choice opens unfilled rather than with a name the server would refuse.
    const toad = await taxon(TOAD);
    const html = await (await fetch(`${BASE_URL}/report?taxonId=${toad}`)).text();
    assert.deepEqual(kinds(html), [
      `/report/roadkill?taxonId=${toad}`,
      "/report/invasive",
      `/report/wildlife?taxonId=${toad}`,
    ]);
    const skink = await taxon(SKINK);
    const invasive = await (await fetch(`${BASE_URL}/report?taxonId=${skink}`)).text();
    assert.deepEqual(kinds(invasive), [
      `/report/roadkill?taxonId=${skink}`,
      `/report/invasive?taxonId=${skink}`,
      `/report/wildlife?taxonId=${skink}`,
    ]);
  });

  test("the waiting-reports banner is on every report page", () => {
    // It owns the queue's challenge and the flush, so a report saved with no
    // signal is sent from whichever report page is opened next.
    for (const file of [
      ["app", "[locale]", "(site)", "report", "page.tsx"],
      ["app", "[locale]", "(site)", "report", "[kind]", "page.tsx"],
    ]) {
      const src = readFileSync(join(import.meta.dirname, "..", ...file), "utf8");
      assert.match(src, /<QueueBanner \/>/, file.join("/"));
      assert.match(src, /<WarmReportPages \/>/, file.join("/"));
    }
  });
});

describe("the server holds a report to its page", () => {
  test("a native animal posted to the invasive page is refused", async () => {
    const toad = await taxon(TOAD);
    const { status, body, row } = await submit({
      page: "invasive",
      category: "invasive",
      taxonId: toad,
    });
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(body.error, "taxon_out_of_scope");
    assert.equal(row, undefined, "nothing was stored");
  });

  test("...which the form shows beside the picker, in words", () => {
    assert.equal(errorKey("taxon_out_of_scope"), "taxon_out_of_scope");
    assert.equal(slotOf(errorKey("taxon_out_of_scope")), "species");
  });

  test("an invasive animal posted to the invasive page is filed", async () => {
    const skink = await taxon(SKINK);
    const { status, body, row } = await submit({
      page: "invasive",
      category: "invasive",
      taxonId: skink,
    });
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(Number(row.taxon_id), Number(skink));
    assert.equal(row.category, "invasive");
  });

  test("a plant is refused on any page", async () => {
    const yew = await taxon(YEW);
    for (const [page, category] of [
      ["wildlife", "sighting"],
      ["roadkill", "roadkill"],
    ]) {
      const { status, body } = await submit({ page, category, taxonId: yew });
      assert.equal(status, 400, `${page}: ${JSON.stringify(body)}`);
      assert.equal(body.error, "taxon_out_of_scope");
    }
  });

  test("a sighting posted on the roadkill page is refused", async () => {
    const { status, body, row } = await submit({ page: "roadkill", category: "sighting" });
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(body.error, "category_not_on_page");
    assert.equal(row, undefined);
    for (const [page, category] of [
      ["wildlife", "invasive"],
      ["invasive", "sighting"],
      ["wildlife", "roadkill"],
    ]) {
      const r = await submit({ page, category });
      assert.equal(r.status, 400, `${category} on ${page}`);
      assert.equal(r.body.error, "category_not_on_page");
    }
  });

  test("a report that does not say its page is held to its category's", async () => {
    // What a report queued offline by an older build sends. It must still go
    // through, and still be held to the page its category belongs to.
    const ok = await submit({ category: "injured" });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const toad = await taxon(TOAD);
    const refused = await submit({ category: "invasive", taxonId: toad });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "taxon_out_of_scope");
  });

  test("the category reaches the classifier as the page filed it", async () => {
    // The per-category policy (lib/report/classifyPolicy.ts) reads the stored
    // category: an invasive page's answer is only ever a suggestion. The page
    // does not rewrite it on the way in.
    for (const [page, category] of [
      ["roadkill", "injured"],
      ["invasive", "invasive"],
      ["wildlife", "sighting"],
    ]) {
      const { status, row } = await submit({ page, category, taxonUnknown: true });
      assert.equal(status, 201);
      assert.equal(row.category, category, page);
    }
  });
});

describe("an invasive-page report stays blurred until someone checks it", () => {
  test("named, it is still held at 10 km", async () => {
    // 多線真稜蜥 has no sensitivity rating, so named anywhere else it is
    // published exactly. On the invasive page the name is the doubtful part.
    const skink = await taxon(SKINK);
    const invasive = await submit({ page: "invasive", category: "invasive", taxonId: skink });
    assert.equal(invasive.row.precision_override, "coarse_10km");
    assert.equal(invasive.row.location_precision, "coarse_10km");

    const wildlife = await submit({ page: "wildlife", category: "sighting", taxonId: skink });
    assert.equal(wildlife.row.precision_override, null, "the hold is the invasive page's alone");
    assert.equal(wildlife.row.location_precision, "exact");
  });

  test("naming it later, by any path, does not lift the hold", async () => {
    // The fragment every naming path uses, read from the source so that this
    // fails if the invasive clause is taken back out of it.
    const src = readFileSync(
      join(import.meta.dirname, "..", "lib", "report", "precision.ts"),
      "utf8",
    );
    const fragment = /export const keepDeliberateOverride = \(\) =>\s*sql`([^`]+)`/.exec(src)?.[1];
    assert.ok(fragment, "keepDeliberateOverride is no longer a plain fragment");
    const skink = await taxon(SKINK);
    await inRollback(async (tx) => {
      const held = await insertReport(tx, { category: "invasive", override: "coarse_10km" });
      const plain = await insertReport(tx, { category: "sighting", override: "coarse_10km" });
      for (const r of [held, plain])
        await tx`update reports
                    set taxon_id = ${skink},
                        precision_override = ${tx.unsafe(fragment)}
                  where id = ${r.id}`;
      const rows = await tx`
        select id, precision_override, location_precision from reports
         where id in (${held.id}, ${plain.id})`;
      const by = Object.fromEntries(rows.map((r) => [r.id, r]));
      assert.equal(by[held.id].precision_override, "coarse_10km", "the invasive page's hold was lifted");
      assert.equal(by[held.id].location_precision, "coarse_10km");
      assert.equal(by[plain.id].precision_override, null, "an ordinary unidentified stamp still clears");
    });
  });

  test("until then, it says it has not been verified", () => {
    assert.equal(awaitingVerification({ category: "invasive", taxonSource: null }), true);
    assert.equal(awaitingVerification({ category: "invasive", taxonSource: "user" }), true);
    assert.equal(awaitingVerification({ category: "invasive", taxonSource: "ai" }), true);
    assert.equal(awaitingVerification({ category: "invasive", taxonSource: "expert" }), false);
    for (const c of ["roadkill", "injured", "sighting"])
      assert.equal(awaitingVerification({ category: c, taxonSource: null }), false, c);
  });

  test("and the reporter's own list says so too", () => {
    const me = readFileSync(
      join(import.meta.dirname, "..", "app", "[locale]", "(site)", "me", "page.tsx"),
      "utf8",
    );
    assert.match(me, /r\.taxon_source as "taxonSource"/);
    assert.match(me, /awaitingVerification\(r\)/);
    assert.match(me, /tr\("receipt\.notVerified"\)/);
  });
});

describe("the picker asks by page", () => {
  const search = async (params) =>
    fetch(`${BASE_URL}/api/species/search?${new URLSearchParams(params)}`);

  test("the invasive page's list holds invasive animals and nothing else", async () => {
    const { results } = await (await search({ q: "蜥", page: "invasive" })).json();
    assert.ok(results.length > 0, "expected invasive lizards");
    assert.ok(results.every((r) => r.isInvasive), "a native animal was offered");
    const toad = await taxon(TOAD);
    const { results: toads } = await (await search({ q: "蟾蜍", page: "invasive" })).json();
    assert.ok(!toads.some((r) => r.id === toad), "the native toad was offered as invasive");
  });

  test("the other pages list animals, not plants", async () => {
    const yew = await taxon(YEW);
    const everything = await (await search({ q: "穗花杉", filter: "all" })).json();
    assert.ok(everything.results.some((r) => r.id === yew), "fixture: the directory finds the plant");
    for (const page of ["wildlife", "roadkill"]) {
      const { results } = await (await search({ q: "穗花杉", page })).json();
      assert.ok(!results.some((r) => r.id === yew), `${page} offered a plant`);
    }
  });

  test("an unknown page is rejected", async () => {
    assert.equal((await search({ q: "a", page: "sighting" })).status, 400);
  });
});
