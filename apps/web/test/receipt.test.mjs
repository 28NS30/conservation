/**
 * The receipt state on /reports/[id].
 *
 * A report that is not published is absent from `reports_public`, and that page
 * reads nothing else — so every reporter whose submission was held followed the
 * link they were given to a 404. The fix is a second, deliberately tiny read of
 * the base table, and a second read of `reports` on a public route is the kind
 * of thing that grows. These tests exist to stop it growing.
 *
 * Two questions are being pinned. What the new query is allowed to touch, which
 * is source-level because a column added in six months' time would be caught by
 * nothing else. And what a holder of an id can actually learn, which is checked
 * against the running server with a real held report.
 *
 *   node --test test/receipt.test.mjs
 */
import { test, describe, after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql, BASE_URL } from "./helpers.mjs";

const read = (...p) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
const RECEIPT = read("lib", "receipt.ts");
const PAGE = read("app", "[locale]", "(site)", "reports", "[id]", "page.tsx");

/** Distinctive enough that finding it in a page is unambiguous. */
const NOTES = "receipt test marker HSINCHU-PANGOLIN-7788";
const EMAIL = "receipt-test@example.invalid";
const LNG = 120.9471;
const LAT = 23.7392;

let heldId;
let suppressedId;

before(async () => {
  // A held report of the kind the form produces: a classifiable category with
  // no photograph, which screenSubmission flags and the route stores as
  // `pending`. Committed rather than rolled back, because the assertion is
  // about what the running server serves.
  const [row] = await sql`
    insert into reports (category, location, location_public, observed_at,
                         notes, contact_email, status, source, flagged_reason)
    values ('roadkill',
            st_setsrid(st_makepoint(${LNG}, ${LAT}), 4326)::geography,
            st_setsrid(st_makepoint(${LNG}, ${LAT}), 4326)::geography,
            now(), ${NOTES}, ${EMAIL}, 'pending', 'user',
            'no photo on a category that expects one')
    returning id`;
  heldId = row.id;

  // A record that is published but whose taxon's coordinates are never shown,
  // so it is absent from reports_public for a completely different reason.
  const [s] = await sql`
    select id from reports
     where location_precision = 'suppressed' and status = 'published'
     limit 1`;
  suppressedId = s?.id ?? null;
});

after(async () => {
  if (heldId) await sql`delete from reports where id = ${heldId}::uuid`;
  await sql.end();
});

describe("the query behind the receipt", () => {
  test("it reads two columns and nothing that describes the record", () => {
    // The whole privacy argument rests on this query staying this small.
    for (const forbidden of ["location", "notes", "contact_email", "st_x", "select *"]) {
      assert.ok(
        !RECEIPT.includes(forbidden),
        `lib/receipt.ts must not mention ${forbidden}`,
      );
    }
    assert.match(RECEIPT, /select status, reporter_id/);
    assert.match(RECEIPT, /source = 'user'/, "imported records get no receipt");
  });

  test("it returns a verdict, not a row", () => {
    // Returning the row would put every column one render away from a page
    // that is served to anyone holding an id.
    assert.match(RECEIPT, /Promise<ReceiptState \| null>/);
    assert.ok(
      !/return row\b/.test(RECEIPT),
      "the row itself must not leave this module",
    );
  });

  test("only `pending` answers to a stranger", () => {
    // `pending` is only ever set at insert and moderation moves rows out of it,
    // never back in — so a row that is pending now has never been in
    // reports_public and its id has never been public either. Any other absent
    // state may have been public once, and confirming that a specific id was
    // withdrawn is a statement about a record someone already scraped.
    assert.match(RECEIPT, /row\.status === "pending"/);
    assert.match(
      RECEIPT,
      /row\.status === "rejected" && viewerId && row\.reporter_id === viewerId/,
      "a rejection is disclosed to its own reporter and to nobody else",
    );
  });

  test("it is a server module, and the page's public read is untouched", () => {
    assert.match(RECEIPT, /^import "server-only";/m);
    assert.match(
      PAGE,
      /from reports_public rp/,
      "the public path must still be the public view, read as web_anon",
    );
    assert.match(
      PAGE,
      /const state = await receiptState\(id, await currentUserId\(\)\)/,
      "the receipt must come from its own module, not from a widened query",
    );
  });
});

describe("what a held report's id discloses", () => {
  test("it opens, in both languages, instead of 404ing", async () => {
    for (const path of [`/reports/${heldId}`, `/en/reports/${heldId}`]) {
      const res = await fetch(`${BASE_URL}${path}`);
      assert.equal(res.status, 200, `${path} should render a receipt`);
    }
  });

  test("and says nothing about the report itself", async () => {
    const html = await (await fetch(`${BASE_URL}/en/reports/${heldId}`)).text();
    const leaks = [
      [NOTES, "the reporter's own words"],
      [EMAIL, "the contact address"],
      [LNG.toFixed(2), "the longitude to two decimals"],
      [LAT.toFixed(2), "the latitude to two decimals"],
      ["maplibregl-map", "a map container"],
    ];
    for (const [needle, what] of leaks) {
      assert.ok(!html.includes(needle), `the receipt leaked ${what}`);
    }
  });

  test("and is kept out of search results", async () => {
    const html = await (await fetch(`${BASE_URL}/reports/${heldId}`)).text();
    assert.match(
      html,
      /<meta name="robots" content="noindex/,
      "an id given to one reporter must not become an indexed page",
    );
  });
});

describe("what every other id gets is the same 404", () => {
  test("an identifier that was never issued", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${BASE_URL}/reports/${crypto.randomUUID()}`);
      assert.equal(res.status, 404);
    }
  });

  test("an imported record, published or not", async (t) => {
    if (!suppressedId) return t.skip("no suppressed record in this database");
    const res = await fetch(`${BASE_URL}/reports/${suppressedId}`);
    assert.equal(
      res.status,
      404,
      "a record withheld as sensitive must be indistinguishable from one that does not exist",
    );
  });

  test("a published record still renders as it always did", async () => {
    const [row] = await sql`select id from reports_public limit 1`;
    const res = await fetch(`${BASE_URL}/reports/${row.id}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      !/<meta name="robots" content="noindex/.test(html),
      "publishing a record should not have become noindex",
    );
  });
});
