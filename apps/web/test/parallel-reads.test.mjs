/**
 * Reads that need nothing from each other are made at once, and a read two
 * parts of one request need is made once.
 *
 * Each of these was a wait in series on a page somebody was looking at: the
 * record page read its photographs, then the model's suggestions, the species
 * card and the counts, then who was looking, then whose report it was; its
 * title read the record a second time. The map named a filtered species only
 * after its figures were in, and the directory counted before it listed.
 *
 *   node --test test/parallel-reads.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serverTiming } from "../lib/serverTiming.ts";
import { speciesSlug, parseSpeciesId } from "../lib/speciesSlug.ts";

const WEB = join(import.meta.dirname, "..");
const code = (p) => readFileSync(join(WEB, p), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const RECORD = "app/[locale]/(site)/reports/[id]/page.tsx";

describe("the record page", () => {
  const page = code(RECORD);

  test("its title and its body share one read of the record, and of the viewer", () => {
    assert.match(page, /const publicRecord = cache\(async \(id: string\): Promise<Row \| null> => \{/);
    assert.match(page, /const pub = await publicRecord\(id\);/);
    assert.match(page, /const publicRow = await timing\.time\("record", publicRecord\(id\)\);/);
    assert.match(page, /const currentRole = cache\(readRole\);/);
    // generateMetadata used to have a query of its own.
    const meta = page.slice(page.indexOf("export async function generateMetadata"), page.indexOf("function Receipt("));
    assert.doesNotMatch(meta, /asPublic\(/);
  });

  test("everything after the record is read at once", () => {
    const all = page.slice(page.indexOf("await Promise.all(["), page.indexOf("]);", page.indexOf("await Promise.all([")));
    for (const read of ["readPhotos()", "readSuggestions", "getSpecies(taxonId)", "monthlyCounts(taxonId)", "readEditor()"])
      assert.ok(all.includes(read), `${read} is not among the reads made together`);
  });

  test("whose report it is, only for someone signed in who is not a moderator", () => {
    const editor = page.slice(page.indexOf("const readEditor = async"), page.indexOf("return { userId, role, owner };"));
    assert.match(editor, /userId && !moderator\s*\?\s*await sql/);
  });

  test("its photographs are signed in one request", () => {
    assert.match(page, /await signedPhotoUrls\(paths, 900\)/);
    assert.doesNotMatch(page, /signedPhotoUrl\(/);
  });
});

describe("the other pages", () => {
  test("the map names a filtered species beside its figures, not after them", () => {
    const map = code("app/[locale]/map/page.tsx");
    assert.match(map, /await Promise\.all\(\[\s*getTranslations\(\),\s*overview\(\),\s*recordedSpeciesCount\(\),\s*taxonId \? namedTaxon\(taxonId\) : null,\s*\]\)/);
  });

  test("the directory lists while it counts", () => {
    const dir = code("app/[locale]/(site)/species/(directory)/page.tsx");
    assert.match(dir, /await Promise\.all\(\[\s*countSpecies\(\{ q, filter \}\),\s*listSpecies\(/);
    // A page past the end is read again, as the last page.
    assert.match(dir, /win\.offset === asked\.offset\s*\?\s*askedRows\s*:\s*await listSpecies/);
  });

  test("the list reads its rows, the span and a filtered species' name together", () => {
    const list = code("app/[locale]/(site)/reports/(list)/page.tsx");
    assert.match(list, /await Promise\.all\(\[\s*readRows,\s*overview\(\),\s*taxonId \? publicSpeciesName\(taxonId\) : null,\s*\]\)/);
  });

  test("a species page and its title share one read", () => {
    assert.match(code("lib/species.ts"), /export const getSpecies = cache\(async \(id: number\)/);
  });

  test("the map's panel links to the species page's own address", () => {
    // /species/32116 answers with a redirect to /species/32116-prionailurus-bengalensis.
    const panel = code("components/map/ReportPanel.tsx");
    assert.match(panel, /href=\{`\/species\/\$\{speciesSlug\(\{ id: report\.taxonId, scientificName: report\.scientificName \?\? "" \}\)\}`\}/);
    assert.doesNotMatch(panel, /from "@\/lib\/species"/, "lib/species.ts would bring the database client into the browser");
  });
});

describe("the helpers", () => {
  test("a slug is the id and the name, and parses back to the id", () => {
    const slug = speciesSlug({ id: 32116, scientificName: "Prionailurus bengalensis" });
    assert.equal(slug, "32116-prionailurus-bengalensis");
    assert.equal(parseSpeciesId(slug), 32116);
    assert.equal(speciesSlug({ id: 7, scientificName: "" }), "7");
  });

  test("server timing marks each read and the whole, in the header's syntax", async () => {
    const timing = serverTiming();
    assert.equal(await timing.time("record", Promise.resolve(1)), 1);
    await assert.rejects(timing.time("photos", Promise.reject(new Error("no"))));
    assert.match(String(timing), /^record;dur=\d+\.\d, photos;dur=\d+\.\d, total;dur=\d+\.\d$/);
  });

  test("and says nothing unless the page was slow", () => {
    const lines = [];
    const warn = console.warn;
    console.warn = (line) => lines.push(line);
    try {
      serverTiming().logIfSlow("record x", 60_000);
      serverTiming().logIfSlow("record y", 0);
    } finally {
      console.warn = warn;
    }
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[record y\] server-timing: total;dur=/);
  });
});
