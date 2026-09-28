/**
 * The season goal stays unlisted until somebody has filed a report.
 *
 * Every public record today was imported from TaiRON, so /season could only
 * say "0 of 40" beside a deadline, linked from the footer of every page. The
 * roadmap's question 20 decided to hide it until reports come in: out of the
 * footer and the sitemap, noindex on the page, the page itself still reachable.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, inRollback, insertReport } from "./helpers.mjs";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const code = (p) =>
  readFileSync(join(WEB, p), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

/** The question seasonOpen() asks, read out of the source so the two cannot drift. */
function seasonQuery() {
  const src = code("lib/coverage.ts");
  const body = src.slice(src.indexOf("export const seasonOpen"));
  const m = body.match(/tx<\{ open: boolean \}\[\]>`([\s\S]*?)`/);
  assert.ok(m, "seasonOpen() no longer asks a single query");
  return m[1];
}

describe("whether the goal is open", () => {
  test("is asked of the public records, and only of reports people filed", () => {
    const q = seasonQuery();
    assert.match(q, /from reports_public/, "must read what the public can see, not reports");
    assert.match(q, /source = 'user'/);
  });

  test("is closed while every public record is an import", async () => {
    const [{ n }] = await sql`select count(*)::int as n from reports_public where source = 'user'`;
    if (n > 0) return; // A database with real reports has nothing to show here.
    const [{ open }] = await sql.unsafe(seasonQuery());
    assert.equal(open, false);
  });

  test("opens with the first published report a person files", async () => {
    await inRollback(async (tx) => {
      await insertReport(tx, { status: "published" });
      const [{ open }] = await tx.unsafe(seasonQuery());
      assert.equal(open, true);
    });
  });

  test("does not open for a report still held back", async () => {
    // A pending report is not public, and the goal counts public records.
    await inRollback(async (tx) => {
      const [{ n }] = await tx`select count(*)::int as n from reports_public where source = 'user'`;
      if (n > 0) return;
      await insertReport(tx, { status: "pending" });
      const [{ open }] = await tx.unsafe(seasonQuery());
      assert.equal(open, false);
    });
  });
});

describe("where the answer is used", () => {
  test("the footer lists /season only when it is open", () => {
    const footer = code("components/site/SiteFooter.tsx");
    assert.match(footer, /seasonOpen\(\)/);
    assert.match(footer, /\.\.\.\(seasonIsOpen \? \[\{ href: "\/season"/);
    assert.equal(footer.match(/"\/season"/g)?.length, 1, "a second, unconditional link to /season");
  });

  test("the sitemap lists /season only when it is open", () => {
    const sitemap = code("app/sitemap.ts");
    assert.match(sitemap, /if \(await seasonOpen\(\)\) staticPaths\.push\("\/season"\)/);
    assert.equal(sitemap.match(/"\/season"/g)?.length, 1, "/season is still in the static list");
  });

  test("the page asks not to be indexed while it is closed", () => {
    const page = code("app/[locale]/(site)/season/page.tsx");
    assert.match(page, /\(await seasonOpen\(\)\) \? \{\} : \{ robots: \{ index: false/);
  });
});
